// Bridges the LEGO extensions' BLE interface to the browser's device picker and GATT API.
export class LegoWebBluetooth {
    static isSupported() {
        return typeof globalThis.navigator?.bluetooth?.requestDevice === 'function';
    }

    constructor(runtime, extensionId, options, onConnect, reset) {
        this.runtime = runtime;
        this.extensionId = extensionId;
        this.onConnect = onConnect;
        this.reset = reset;
        this.active = true;
        this.device = null;
        this.server = null;
        this.notification = null;
        this.writes = Promise.resolve();
        this.onDisconnected = this.onDisconnected.bind(this);
        this.requestDevice(options);
    }

    async requestDevice(options) {
        // The Xcratch scan button calls this synchronously during the click.
        const filters = options.filters.map(({services, manufacturerData}) => ({
            services,
            manufacturerData: Object.entries(manufacturerData).map(([id, {dataPrefix, mask}]) => {
                const companyIdentifier = Number(id);
                if (!dataPrefix.length) return {companyIdentifier};
                return {
                    companyIdentifier,
                    dataPrefix: Uint8Array.from(dataPrefix),
                    ...(mask && {mask: Uint8Array.from(mask)})
                };
            })
        }));
        try {
            const device = await navigator.bluetooth.requestDevice({filters, optionalServices: options.optionalServices});
            if (!this.active) return;
            this.device = device;
            // Xcratch's auto-scan then calls connectPeripheral with the chosen ID.
            this.runtime.emit(this.runtime.constructor.PERIPHERAL_LIST_UPDATE, {
                [device.id]: {peripheralId: device.id, name: device.name}
            });
        } catch (error) {
            if (!this.active) return;
            this.active = false;
            if (error.name === 'NotFoundError') {
                this.runtime.emit(this.runtime.constructor.PERIPHERAL_SCAN_TIMEOUT);
            } else {
                this.reportError(this.runtime.constructor.PERIPHERAL_REQUEST_ERROR, error);
            }
        }
    }

    async connectPeripheral(id) {
        const device = this.device;
        if (!device || device.id !== id) return;

        device.addEventListener('gattserverdisconnected', this.onDisconnected);
        try {
            const server = await device.gatt.connect();
            if (!this.active) return;
            this.server = server;
            await this.onConnect();
            if (this.isConnected()) {
                this.runtime.emit(this.runtime.constructor.PERIPHERAL_CONNECTED);
            }
        } catch (error) {
            if (!this.active) return;
            this.disconnect();
            this.reset();
            this.reportError(this.runtime.constructor.PERIPHERAL_REQUEST_ERROR, error);
        }
    }

    disconnect() {
        if (!this.active) return;
        this.active = false;
        this.device?.removeEventListener('gattserverdisconnected', this.onDisconnected);
        if (this.notification) {
            const {characteristic, listener} = this.notification;
            characteristic.removeEventListener('characteristicvaluechanged', listener);
            this.notification = null;
        }
        this.device?.gatt.disconnect();
        this.device = null;
        this.server = null;
        this.runtime.emit(this.runtime.constructor.PERIPHERAL_DISCONNECTED);
    }

    isConnected() {
        return this.active && Boolean(this.server?.connected);
    }

    startNotifications(serviceId, characteristicId, onMessage) {
        this.characteristic = this.server.getPrimaryService(serviceId)
            .then(service => service.getCharacteristic(characteristicId))
            .then(async characteristic => {
                if (!this.isConnected()) return;
                const listener = event => {
                    const {buffer, byteOffset, byteLength} = event.target.value;
                    const bytes = new Uint8Array(buffer, byteOffset, byteLength);
                    onMessage(btoa(String.fromCharCode(...bytes)));
                };
                this.notification = {characteristic, listener};
                characteristic.addEventListener('characteristicvaluechanged', listener);
                await characteristic.startNotifications();
                return characteristic;
            });
        return this.characteristic;
    }

    write(_serviceId, _characteristicId, message, _encoding, withResponse) {
        // LEGO devices use a single characteristic and send base64 through the existing Hub API.
        const bytes = Uint8Array.from(atob(message), char => char.charCodeAt(0));
        this.writes = this.writes.then(async () => {
            if (!this.isConnected()) return;
            const characteristic = await this.characteristic;
            if (!this.isConnected()) return;
            if (withResponse && characteristic.properties.write) {
                await characteristic.writeValueWithResponse(bytes);
            } else {
                await characteristic.writeValueWithoutResponse(bytes);
            }
        }).catch(error => {
            if (this.active) this.onDisconnected(error);
        });
        return this.writes;
    }

    onDisconnected(event) {
        if (!this.active) return;
        this.disconnect();
        this.reset();
        this.reportError(this.runtime.constructor.PERIPHERAL_CONNECTION_LOST_ERROR, event);
    }

    reportError(event, error) {
        this.runtime.emit(event, {
            message: error.message || 'Scratch lost connection to',
            extensionId: this.extensionId
        });
    }
}
