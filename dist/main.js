import { InstanceBase, runEntrypoint, InstanceStatus } from '@companion-module/base';
import { getConfigFields } from './config.js';
import { getActions } from './actions.js';
import { getFeedbacks } from './feedbacks.js';
import { getPresets } from './presets.js';
import { getVariableDefinitions, getDefaultVariableValues } from './variables.js';
import WebSocket from 'ws';

export class RiedelInstance extends InstanceBase {
    ws = null;
    config = { host: '', port: 80 };
    reconnectTimer = null;
    interfaceIps = new Map();
    networkSettings = null;
    healthStatus = 'Unknown';
    alarmList = [];
    alarmHistory = [];
    ptpStatus = 'Unknown';
    ptpMaster = 'Unknown';
    ptpDomain = 0;
    ptpHybridMode = true;
    ptpReceiverOnly = true;
    controlPanelEnabled = false;
    nmosEnabled = false;
    nmosStatus = 'Unknown';

    constructor(internal) {
        super(internal);
    }

    async init(config) {
        this.config = config;
        this.setActionDefinitions(getActions(this));
        this.setFeedbackDefinitions(getFeedbacks(this));
        this.setPresetDefinitions(getPresets());
        this.setVariableDefinitions(getVariableDefinitions());
        this.setVariableValues(getDefaultVariableValues());
        this.initWebSocket();
    }

    async destroy() {
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
    }

    async configUpdated(config) {
        this.config = config;
        if (this.ws) {
            this.ws.close();
        }
        this.initWebSocket();
    }

    initWebSocket() {
        if (!this.config.host) {
            this.updateStatus(InstanceStatus.BadConfig, 'No host configured');
            return;
        }
        const wsUrl = `ws://${this.config.host}:${this.config.port}/websocket`;
        this.log('info', `Connecting to ${wsUrl}`);
        try {
            this.ws = new WebSocket(wsUrl);
            this.ws.on('open', () => {
                this.log('info', 'WebSocket connected');
                this.updateStatus(InstanceStatus.Ok);
                this.setVariableValues({ connection_status: 'Connected' });
                this.checkFeedbacks('connectionStatus');
                // Fetch initial network status and settings for all interfaces
                this.fetchNetworkStatus('Media1');
                this.fetchNetworkStatus('Config1');
                this.fetchNetworkStatus('Media2');
                this.fetchNetworkSettings();
                this.fetchDeviceInfo();
                // Fetch initial health, alarm, and PTP status
                this.fetchHealthStatus();
                this.fetchAlarmList();
                this.fetchPtpStatus();
                this.fetchPtpSettings();
                // Fetch control panel and NMOS status
                this.fetchControlPanelConfig();
                this.fetchNmosStatus();
            });
            this.ws.on('message', (data) => {
                this.handleMessage(data.toString());
            });
            this.ws.on('error', (error) => {
                this.log('error', `WebSocket error: ${error.message}`);
                this.updateStatus(InstanceStatus.ConnectionFailure, error.message);
            });
            this.ws.on('close', () => {
                this.log('warn', 'WebSocket disconnected');
                this.updateStatus(InstanceStatus.Disconnected);
                this.setVariableValues({ connection_status: 'Disconnected' });
                this.checkFeedbacks('connectionStatus');
                // Attempt to reconnect after 5 seconds
                this.reconnectTimer = setTimeout(() => {
                    this.initWebSocket();
                }, 5000);
            });
        }
        catch (error) {
            this.log('error', `Failed to create WebSocket: ${error}`);
            this.updateStatus(InstanceStatus.ConnectionFailure, String(error));
        }
    }

    handleMessage(message) {
        try {
            const data = JSON.parse(message);
            const topic = data.topic;
            this.log('debug', `Received: ${topic}`);

            if (topic === '/NetworkStatus/FetchNetworkStatusResponse') {
                const interfaceId = data.body.interfaceId;
                const ipAddress = data.body.ipv4Status?.ipAddress;
                if (ipAddress) {
                    this.interfaceIps.set(interfaceId, ipAddress);
                    const variableUpdates = {};
                    if (interfaceId === 'Media1')
                        variableUpdates.media1_ip = ipAddress;
                    if (interfaceId === 'Config1')
                        variableUpdates.config1_ip = ipAddress;
                    if (interfaceId === 'Media2')
                        variableUpdates.media2_ip = ipAddress;
                    this.setVariableValues(variableUpdates);
                    this.checkFeedbacks('interfaceIp');
                }
                if (data.body.macAddress) {
                    this.setVariableValues({ mac_address: data.body.macAddress });
                }
            }
            else if (topic === '/DeviceInfo/FetchDeviceInfoResponse') {
                const updates = {};
                if (data.body.deviceName)
                    updates.device_name = data.body.deviceName;
                if (data.body.firmwareVersion)
                    updates.firmware_version = data.body.firmwareVersion;
                this.setVariableValues(updates);
            }
            else if (topic === '/NetworkSettings/FetchNetworkSettingsResponse') {
                this.networkSettings = data.body.networkSettings;
                this.log('info', `Network settings received: ${this.networkSettings ? 'OK' : 'null'}`);
            }
            else if (topic === '/NetworkSettings/UpdateNetworkSettingsResponse') {
                this.log('info', 'Network settings updated successfully');
                // Refresh network status after update
                this.fetchNetworkStatus('Media1');
                this.fetchNetworkStatus('Config1');
                this.fetchNetworkStatus('Media2');
            }
            else if (topic === '/StatusInfo/FetchHealthStatusResponse') {
                if (data.body.healthStatus) {
                    this.healthStatus = data.body.healthStatus;
                    this.setVariableValues({ health_status: this.healthStatus });
                    this.checkFeedbacks('healthStatus', 'healthStatusDisplay');
                    this.log('info', `Health status: ${this.healthStatus}`);
                }
            }
            else if (topic === '/StatusInfo/HealthStatusChanged') {
                if (data.body.healthStatus) {
                    this.healthStatus = data.body.healthStatus;
                    this.setVariableValues({ health_status: this.healthStatus });
                    this.checkFeedbacks('healthStatus', 'healthStatusDisplay');
                }
            }
            else if (topic === '/StatusInfo/FetchAlarmListResponse') {
                if (data.body.alarmList) {
                    this.alarmList = data.body.alarmList;
                    this.setVariableValues({ alarm_count: String(this.alarmList.length) });
                    this.checkFeedbacks('alarmCount', 'alarmCountDisplay');
                    this.log('info', `Alarm count: ${this.alarmList.length}`);
                }
            }
            else if (topic === '/StatusInfo/AlarmListChanged') {
                this.fetchAlarmList();
            }
            else if (topic === '/StatusInfo/FetchAlarmHistoryResponse') {
                if (data.body.alarmHistory) {
                    this.alarmHistory = data.body.alarmHistory;
                    this.log('info', `Alarm history received: ${this.alarmHistory.length} entries`);
                }
            }
            else if (topic === '/Ptp/FetchPtpStatusResponse') {
                if (data.body.ptpStatus) {
                    this.ptpStatus = data.body.ptpStatus;
                    this.setVariableValues({ ptp_status: this.ptpStatus });
                    this.checkFeedbacks('ptpStatus', 'ptpStatusDisplay');
                    this.log('info', `PTP status: ${this.ptpStatus}`);
                }
                if (data.body.timeTransmitter) {
                    this.ptpMaster = data.body.timeTransmitter;
                    this.setVariableValues({ ptp_master: this.ptpMaster });
                }
            }
            else if (topic === '/Ptp/PtpStatusChanged') {
                this.fetchPtpStatus();
            }
            else if (topic === '/Ptp/FetchPtpSettingsResponse') {
                if (data.body.domain !== undefined) {
                    this.ptpDomain = data.body.domain;
                    this.setVariableValues({ ptp_domain: String(this.ptpDomain) });
                }
                if (data.body.hybridMode !== undefined) {
                    this.ptpHybridMode = data.body.hybridMode;
                    this.setVariableValues({ ptp_hybrid_mode: this.ptpHybridMode ? 'Enabled' : 'Disabled' });
                }
                if (data.body.timeReceiverOnly !== undefined) {
                    this.ptpReceiverOnly = data.body.timeReceiverOnly;
                    this.setVariableValues({ ptp_receiver_only: this.ptpReceiverOnly ? 'Yes' : 'No' });
                }
            }
            else if (topic === '/Ptp/UpdatePtpSettingsResponse') {
                this.log('info', 'PTP settings updated successfully');
                this.fetchPtpSettings();
            }
            else if (topic === '/ControlPanelApp/FetchConfigResponse') {
                if (data.body.enabled !== undefined) {
                    this.controlPanelEnabled = data.body.enabled;
                    this.setVariableValues({ control_panel_enabled: this.controlPanelEnabled ? 'Yes' : 'No' });
                    this.checkFeedbacks('controlPanelEnabled');
                    this.log('info', `Control panel enabled: ${this.controlPanelEnabled}`);
                }
            }
            else if (topic === '/ControlPanelApp/ConfigChanged') {
                this.fetchControlPanelConfig();
            }
            else if (topic === '/Nmos/FetchStatusResponse') {
                if (data.body.enabled !== undefined) {
                    this.nmosEnabled = data.body.enabled;
                    this.setVariableValues({ nmos_enabled: this.nmosEnabled ? 'Yes' : 'No' });
                    this.checkFeedbacks('nmosEnabled');
                }
                if (data.body.status) {
                    this.nmosStatus = data.body.status;
                    this.setVariableValues({ nmos_status: this.nmosStatus });
                }
                this.log('info', `NMOS enabled: ${this.nmosEnabled}, status: ${this.nmosStatus}`);
            }
            else if (topic === '/Nmos/StatusChanged') {
                this.fetchNmosStatus();
            }
        }
        catch (error) {
            this.log('error', `Failed to parse message: ${error}`);
        }
    }

    sendMessage(topic, body = {}) {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
            this.log('warn', 'WebSocket not connected');
            return;
        }
        const message = JSON.stringify({ topic, body });
        this.ws.send(message);
        this.log('debug', `Sent: ${topic}`);
    }

    // Network methods
    async setIpAddress(interfaceId, ipAddress, subnetMask, gateway, prefixLength, dhcp) {
        if (!this.networkSettings) {
            this.log('warn', 'Current network settings not available, fetching...');
            this.fetchNetworkSettings();
            await new Promise((resolve) => setTimeout(resolve, 1000));
            if (!this.networkSettings) {
                this.log('error', 'Failed to fetch current network settings');
                return;
            }
        }
        const updatedSettings = JSON.parse(JSON.stringify(this.networkSettings));
        const targetInterface = updatedSettings.networkInterfaceSettings.find((iface) => iface.interfaceId === interfaceId);
        if (!targetInterface) {
            this.log('error', `Interface ${interfaceId} not found`);
            return;
        }
        targetInterface.dhcpActive = dhcp;
        targetInterface.ipv4Settings.ipAddress = ipAddress;
        targetInterface.ipv4Settings.networkMaskConverted = subnetMask;
        targetInterface.ipv4Settings.defaultGateway = gateway;
        targetInterface.ipv4Settings.prefixLength = prefixLength;
        this.sendMessage('/NetworkSettings/UpdateNetworkSettings', {
            networkSettings: updatedSettings,
        });
    }

    async fetchNetworkStatus(interfaceId) {
        this.sendMessage('/NetworkStatus/FetchNetworkStatus', { interfaceId });
    }

    async fetchNetworkSettings() {
        this.sendMessage('/NetworkSettings/FetchNetworkSettings', {});
    }

    // Device methods
    async rebootDevice() {
        this.sendMessage('/Reboot/RebootDevice', {});
    }

    async fetchDeviceInfo() {
        this.sendMessage('/DeviceInfo/FetchDeviceInfo', {});
    }

    // Health and Alarm methods
    async fetchHealthStatus() {
        this.sendMessage('/StatusInfo/FetchHealthStatus', {});
    }

    async fetchAlarmList() {
        this.sendMessage('/StatusInfo/FetchAlarmList', {});
    }

    async fetchAlarmHistory() {
        this.sendMessage('/StatusInfo/FetchAlarmHistory', {});
    }

    // PTP methods
    async fetchPtpStatus() {
        this.sendMessage('/Ptp/FetchPtpStatus', {});
    }

    async fetchPtpSettings() {
        this.sendMessage('/Ptp/FetchPtpSettings', {});
    }

    async updatePtpSettings(domain, hybridMode, timeReceiverOnly) {
        this.sendMessage('/Ptp/UpdatePtpSettings', {
            domain,
            hybridMode,
            timeReceiverOnly,
        });
    }

    // Control Panel methods
    async fetchControlPanelConfig() {
        this.sendMessage('/ControlPanelApp/FetchConfig', {});
    }

    async enableControlPanel() {
        this.sendMessage('/ControlPanelApp/Enable', {});
        setTimeout(() => this.fetchControlPanelConfig(), 500);
    }

    async disableControlPanel() {
        this.sendMessage('/ControlPanelApp/Disable', {});
        setTimeout(() => this.fetchControlPanelConfig(), 500);
    }

    async toggleControlPanel() {
        if (this.controlPanelEnabled) {
            await this.disableControlPanel();
        } else {
            await this.enableControlPanel();
        }
    }

    // NMOS methods
    async fetchNmosStatus() {
        this.sendMessage('/Nmos/FetchStatus', {});
    }

    async enableNmos() {
        this.sendMessage('/Nmos/Enable', {});
        setTimeout(() => this.fetchNmosStatus(), 500);
    }

    async disableNmos() {
        this.sendMessage('/Nmos/Disable', {});
        setTimeout(() => this.fetchNmosStatus(), 500);
    }

    async toggleNmos() {
        if (this.nmosEnabled) {
            await this.disableNmos();
        } else {
            await this.enableNmos();
        }
    }

    // Getter methods for feedbacks
    isConnected() {
        return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
    }

    getInterfaceIp(interfaceId) {
        return this.interfaceIps.get(interfaceId);
    }

    getHealthStatus() {
        return this.healthStatus;
    }

    getAlarmCount() {
        return this.alarmList.length;
    }

    getPtpStatus() {
        return this.ptpStatus;
    }

    getControlPanelEnabled() {
        return this.controlPanelEnabled;
    }

    getNmosEnabled() {
        return this.nmosEnabled;
    }

    getConfigFields() {
        return getConfigFields();
    }
}

runEntrypoint(RiedelInstance, []);
//# sourceMappingURL=main.js.map
