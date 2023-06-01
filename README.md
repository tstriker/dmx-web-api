# DMX Control directly from your browser

This super tiny lib knows how to talk DMX through browser's [Web Serial API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Serial_API).
Currently [Enttec's Open DMX](https://www.enttec.com/product/lighting-communication-protocols/dmx512/open-dmx-usb/) and
[Eurolite's USB-DMX512 PRO Interface MK2](https://www.thomann.de/gb/eurolite_usb_dmx512_pro_interface_mk2.htm) are supported.
Patches for other devices are most welcome!

# Note: the API is supported by Chrome only!

Unfortunately other browsers do not yet support neither the Serial nor USB API's, generally claiming security reasons.

# Install

`npm install dmx-web-api`

# Demo

```javascript
import {DMX, Eurolite} from "dmx-web-api";

let dmxDevice = new DMX();

function initDMX() {
    // the three params passed into init are as follows:
    // * onTick - callback that will be executed on every tick
    // * backendClass - the class of the backend widget. right now there is just Eurolite and Enttec's Open USB
    // * requestAccess - default:false, when set to true will ask user to give us access. you can do that only on
    //   user action. so on init you can call it with false, and then have an interface element that allows user to
    //   enable access to the device
    this.dmxDevice.connect(null, Eurolite, true);
}

function updateDMX(data) {
    // data can be either an object of form {channel: value}, or a full 512 element array.
    // set first channel to 255 (say, because you have a simple RGB light listening on address 1)
    this.dmxDevice.update({1: 255, 2: 0, 3: 0});
}
```

# Note on Enttec's Open DMX

Make sure the tab you are sending the signal from is visible at all times, as chrome will spin down the internal
timers when the tab is not visible, and you will get flickering lights.
A simple way around that is to run a tiny node server and talk sockets to it. Code for doing that is in the [github repo](https://github.com/tstriker/dmx-web-api/tree/main/node-server).
