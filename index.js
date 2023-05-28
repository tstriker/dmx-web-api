export class DMX {
    constructor() {
        this.port = null;
        this.data = new Uint8Array(512);
        this.writer = null;
        this.ready = false;
        this.onTick = null;
        this._sendInterval = null;

        this.serialNumber = null;
        this.backend = null;
        this.bySerial = {
            [Eurolite.serialNumber]: Eurolite,
            [EnttecOpen.serialNumber]: EnttecOpen,
        };
    }

    async canAccess() {
        let ports = await navigator.serial.getPorts();
        return ports.length > 0;
    }

    async connectToDongle(askPermission = true) {
        // we want to sniff out the serial number, but the web serial API does not give us that information
        // (something about fingerprinting, which is stupid, because webUSB api does hand that information)
        // so we first ask for permission from webUSB and then get the actual writer from webSerial
        let devices = await navigator.usb.getDevices({filters: [{vendorId: 0x0403}]});
        let ports = await navigator.serial.getPorts({filters: [{usbVendorId: 0x0403}]});
        this.writer = null;
        this.port = null;

        if (!devices.length && askPermission) {
            await navigator.usb.requestDevice({filters: [{vendorId: 0x0403}]});
            devices = await navigator.usb.getDevices({filters: [{vendorId: 0x0403}]});
        }

        if (devices.length) {
            this.serialNumber = devices[0].serialNumber;

            if (!ports.length && askPermission) {
                await navigator.serial.requestPort({filters: [{usbVendorId: 0x0403}]});
                ports = await navigator.serial.getPorts({filters: [{usbVendorId: 0x0403}]});
            }
        }

        if (ports.length) {
            // just grab the first one; not gonna deal with multi usb-to-dmx setup just yet
            let port = ports[0];
            try {
                await port.open({
                    baudRate: 250 * 1000,
                    dataBits: 8,
                    stopBits: 2,
                    parity: "none",
                });
            } catch (e) {
                if (e.name != "InvalidStateError") {
                    // invalid state error is when port is already open, which is fine by us.
                    // Anything else we throw
                    throw e;
                }
            }

            this.port = port;
            this.writer = await this.port.writable.getWriter();
        }
    }

    async connect(onTick, askPermission = true) {
        this.onTick = onTick;
        if (this.ready) {
            return;
        }

        await this.connectToDongle(askPermission);
        if (!this.writer) {
            return;
        }

        if (this.bySerial[this.serialNumber]) {
            this.backend = new this.bySerial[this.serialNumber](this.port, this.writer);
            this.ready = true;
            this._sendLoop();
        } else {
            console.error("unrecognized serial number:", this.serialNumber);
        }
    }

    async _sendLoop() {
        clearInterval(this._sendInterval);
        if (this.writer) {
            if (this.onTick) {
                this.onTick();
            }

            this.backend.sendSignal(this.data).catch(error => {
                this.writer = null;
                this.ready = false;
                // Note: the failure message will appear in the logs a few times as we are not doing blocking requests
                // here and so we might try issuing a bunch of sendSignals before we catch up with the fact that
                // the dongle is gone
                console.error(error);
                console.error("Failed to send signal to DMX controller, will attempt to reconnect");
            });

            // Note: DMX protocol operates at max 44fps (but 40fps is safer as enttec pushes for that), so best we can
            // hope for is a frame every 25ms https://en.wikipedia.org/wiki/DMX512
            this._sendInterval = setTimeout(() => this._sendLoop(), 25);
        } else {
            await this.connect(this.onTick, false);

            if (!this.writer) {
                console.info("Reconnect failed. Retry in 300ms");
                this._sendInterval = setTimeout(() => this._sendLoop(), 300);
            }
        }
    }

    async update(data) {
        if (!this.backend) {
            console.log("Can't run update before init() has been called!");
            return;
        }

        Object.entries(data).forEach(([ch, val]) => {
            let [chInt, valInt] = [parseInt(ch), parseInt(val)];
            if (chInt < 1 || chInt > 512) {
                console.error(`Channel should be between 1 and 512. Received ${ch}`);
            } else if (valInt < 0 || valInt > 255) {
                console.error(`Value should be between 0 and 255. Received channel: ${ch}, value: ${val}`);
            } else {
                this.data[chInt - 1] = valInt;
            }
        });
        this.backend.onUpdate(data);
    }

    async close() {
        clearInterval(this._sendInterval);
        await this.writer.releaseLock();
        await this.port.close();
        this.ready = false;
    }
}

class Backend {
    // abstract away the different ways to talk DMX
    label = "";
    init() {}
    onUpdate() {}
    sendSignal() {}
    close() {}
}

export class SerialBackend extends Backend {
    // serial uses the web serial API directly
    // https://developer.mozilla.org/en-US/docs/Web/API/Web_Serial_API
    constructor(port, writer) {
        super();
        this.port = port;
        this.writer = writer;
    }
}

export class Eurolite extends SerialBackend {
    // a buffered interface that is very specific about its init message
    static label = "Eurolite DMX512 Pro Mk2";
    static serialNumber = "AQ01F1UV";

    constructor(port, writer) {
        super(port, writer);
        this.same = 0;
    }

    onUpdate() {
        this.same = 0;
    }

    async sendSignal(data) {
        if (this.same > 3 || !this.writer) {
            return;
        }
        // every now and then the cache loses a frame and we end up with not the final state
        // to mitigated that instead of using a 'changed' boolean we use a sameness incrementor
        // this means that we'll send 4 frames of the final state when things calm down
        this.same += 1;
        await this.writer.ready;
        await this.writer.write(new Uint8Array([0x7e, 0x06, 0x01, 0x02, 0x00, ...data, 0xe7]));
    }
}

export class EnttecOpen extends SerialBackend {
    // just a dumb forwarder. one caveat is that you have to keep the tab visible or
    // otherwise chrome will spin down the timers and the lights will start flickering
    static label = "Enttec Open DMX USB in browser. Keep the tab visible!";
    static serialNumber = "AB0MRQT7";

    async sendSignal(data) {
        if (!this.port || !this.writer) {
            // we are not ready yet
            return;
        }

        await this.port.setSignals({break: true, requestToSend: false});
        await this.port.setSignals({break: false, requestToSend: false});
        await this.writer.write(new Uint8Array([0x00, ...data]));
    }
}
