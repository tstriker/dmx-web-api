const {Server} = require("socket.io");
const EnttexDMX = require("enttec-open-dmx-usb");
const DMXDevice = EnttexDMX.EnttecOpenDMXUSBDevice;

let device;
(async () => {
    try {
        let first = await DMXDevice.getFirstAvailableDevice();
        device = new DMXDevice(first);
    } catch (e) {
        console.log("Couldn't connect to the DMX dongle.", e);
    }
})();

const io = new Server(8090, {
    cors: {
        origin: true,
        credentials: true,
    },
});

io.on("connection", socket => {
    socket.on("update", ({data, replace}) => {
        if (replace) {
            for (let i = 1; i <= 255; i++) {
                let val = parseInt(data[i]);
                if (val >= 0 && val <= 255) {
                    data[i] = data[i] || 0;
                } else {
                    console.log(`Channel ${i} out of bounds: ${data[i]}`);
                }
            }
        }
        if (device) {
            device.setChannels(data);
        }
    });
});
