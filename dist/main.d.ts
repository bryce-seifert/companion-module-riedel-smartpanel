import { InstanceBase } from '@companion-module/base';
import { type ModuleConfig } from './config.js';
export declare class RiedelInstance extends InstanceBase<ModuleConfig> {
    private ws;
    private config;
    private reconnectTimer;
    private interfaceIps;
    private networkSettings;
    private healthStatus;
    private alarmList;
    private ptpStatus;
    private ptpMaster;
    private ptpDomain;
    private ptpHybridMode;
    private ptpReceiverOnly;
    constructor(internal: unknown);
    init(config: ModuleConfig): Promise<void>;
    destroy(): Promise<void>;
    configUpdated(config: ModuleConfig): Promise<void>;
    private initWebSocket;
    private handleMessage;
    private sendMessage;
    setIpAddress(interfaceId: string, ipAddress: string, subnetMask: string, gateway: string, prefixLength: number, dhcp: boolean): Promise<void>;
    fetchNetworkStatus(interfaceId: string): Promise<void>;
    rebootDevice(): Promise<void>;
    fetchDeviceInfo(): Promise<void>;
    fetchHealthStatus(): Promise<void>;
    fetchAlarmList(): Promise<void>;
    fetchPtpStatus(): Promise<void>;
    fetchPtpSettings(): Promise<void>;
    updatePtpSettings(domain: number, hybridMode: boolean, timeReceiverOnly: boolean): Promise<void>;
    isConnected(): boolean;
    getInterfaceIp(interfaceId: string): string | undefined;
    getHealthStatus(): string;
    getAlarmCount(): number;
    getPtpStatus(): string;
    getConfigFields(): import("@companion-module/base").SomeCompanionConfigField[];
}
//# sourceMappingURL=main.d.ts.map