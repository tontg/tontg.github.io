// https://github.com/Wnt/flow-bluetooth-printer

/*function str2ab(str) {
 var buf = new ArrayBuffer(str.length); // 2 bytes for each char
 var bufView = new Uint8Array(buf);
 for (var i=0, strLen=str.length; i < strLen; i++) {
 bufView[i] = str.charCodeAt(i);
 }
 return buf;
 }*/

// TODO : replace by original file
// TODO : add constructor for setting UUID for service & characteristic

(function () {
    'use strict';

    class BluetoothPrinterAPI {
        constructor() {
            this._EVENTS = {};
            this._CHARACTERISTIC = null;
            this._QUEUE = [];
            this._WORKING = false;
        }

        connect() {
            console.log('Requesting Bluetooth Device...');
            return new Promise((resolve, reject) => {
                // TODO : export SERVICE_UUID & CHARACTERISTIC_UUID outside of class
                const SERVICE_UUID = //"0000fff0-0000-1000-8000-00805f9b34fb";
                        '000018f0-0000-1000-8000-00805f9b34fb'; // aka 18F0 pour modele noir POS-5809LN
                console.log("trying to connect to service UUID " + SERVICE_UUID);
                const CHARACTERISTIC_UUID =
                        // "0000fff1-0000-1000-8000-00805f9b34fb" // doesn't work on black printer
                        // "0000fff2-0000-1000-8000-00805f9b34fb" // doesn't work on black printer
                        // "0000fff3-0000-1000-8000-00805f9b34fb" // doesn't work on black printer
                        // "0000fff4-0000-1000-8000-00805f9b34fb" // doesn't work on black printer
                        // "0000fff5-0000-1000-8000-00805f9b34fb" // works but does nothing
                        // "0000fff6-0000-1000-8000-00805f9b34fb" // doesn't work on black printer
                        "00002af1-0000-1000-8000-00805f9b34fb" // works on black printer
                        ;
                navigator.bluetooth
                        .requestDevice({
                            filters: [{services: [SERVICE_UUID]}]
                        })
                        .then(device => {
                            console.log("Device found. Connecting to GATT Server...");
                            device.addEventListener('gattserverdisconnected', this._disconnect.bind(this));
                            return device.gatt.connect();
                        })
                        .then(server => {
                            if (!server) {
                                reject();
                            }
                            return server.getPrimaryService(SERVICE_UUID);
                        })
                        .then(service => {
                            if (!service) {
                                reject();
                            }
                            return service.getCharacteristic(CHARACTERISTIC_UUID);
                        })
                        .then(characteristic => {
                            this._CHARACTERISTIC = characteristic;
                            resolve();
                        })
                        .catch(error => {
                            console.log('Could not connect! ' + error);
                            reject();
                        });
            });
        }

        print(command) {
            // console.log("command: " + command);
            // can send max 512 bytes per BLE command
            const maxLength = 512; // sometimes 100, but 90 for our Memobird, 512 for black printer
            let chunks = Math.ceil(command.length / maxLength);
            console.log("printing command... length: " + command.length + " chunks: " + chunks);
            if (chunks === 1) {
                this._queue(command);
            } else {
                for (let i = 0; i < chunks; i++) {
                    let byteOffset = i * maxLength;
                    let length = Math.min(command.length, byteOffset + maxLength);
                    this._queue(command.slice(byteOffset, length));
                }
            }
        }

        _queue(f) {
            var that = this;
            function run() {
                if (!that._QUEUE.length) {
                    that._WORKING = false;
                    console.log("endprinting.");
                    return;
                }
                that._WORKING = true;
                // console.log("printing portion...");
                // "toto\r\n\r\n\r\n\r\n"
                // var buffer = str2ab(textToPrint + "\r\n\r\n\r\n\r\n");
                // console.log("buffer length: " + buffer.byteLength);
                // console.log("_QUEUE: " + that._QUEUE);
                // console.log("_CHARACTERISTIC: " + that._CHARACTERISTIC);
                if (that._CHARACTERISTIC === null) {
                    throw new Error("that._CHARACTERISTIC is null, bluetooth printer not connected");
                }
                that._CHARACTERISTIC
                        // .writeValue(buffer)
                        .writeValue(that._QUEUE.shift())
                        .then(function () {
                            run();
                        });
            }

            that._QUEUE.push(f);

            if (!that._WORKING)
                run();
        }

        addEventListener(e, f) {
            this._EVENTS[e] = f;
        }

        isConnected() {
            return !!this._CHARACTERISTIC;
        }

        _disconnect() {
            console.log('Disconnected from GATT Server...');

            this._CHARACTERISTIC = null;

            if (this._EVENTS['disconnected']) {
                this._EVENTS['disconnected']();
            }
        }
    }

    window.BluetoothPrinterAPI = new BluetoothPrinterAPI();
})();

