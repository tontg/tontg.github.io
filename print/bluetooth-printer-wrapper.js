/* global BluetoothPrinterAPI, _imageUrl */

// BluetoothPrinterAPI: https://github.com/Wnt/flow-bluetooth-printer
// ESC/POS encoder: https://github.com/NielsLeenheer/EscPosEncoder
class BluetoothPrinter {
    constructor() {
        //super();
        this.encoder = new EscPosEncoder({
            imageMode: 'raster'
        });
        // this.encoder.codepage("cp437");//"windows1252");
    }

    /**
     * This can only be called when handling an user gesture on the client-side. Otherwise it will cause a
     * SecurityError
     */
    connect() {
        return new Promise((resolve, reject) => {
            BluetoothPrinterAPI.connect()
                    .then(() => {
                        console.log('connected to printer');
                        BluetoothPrinterAPI.addEventListener('disconnected', () => {
                            console.log('disconnected from printer');
                        });
                        resolve();
                    }).catch((e) => {
                if (!navigator.bluetooth) {
                    window.alert("the browser does not support Web Bluetooth API");
                } else {
                    window.alert('Connection to printer failed, please try again! - ' + e);
                }
                console.log(e);
                reject();
            });
        });
    }

    print(msg) {
        if (!BluetoothPrinterAPI.isConnected()) {
            console.log("printer is not connected, connecting before executing command...");
            // let's connect, then we'll print
            this.connect()
                    .then(() => {
                        this.print(msg);
                    })
                    .catch((e) => {
                        console.log(e);
                    });
            return;
        } else {
            // normal text: 32 characters per line
            // small text: 42 characters per line
            let command = this.encoder
                    .text(msg)
                    .newline()
                    .text('8<------------------------------')
                    .newline()
                    .newline()
                    .newline()
                    .encode();
            BluetoothPrinterAPI.print(command);
        }
    }

    // doesn't work on memobird
    qrCode(value) {
        if (!BluetoothPrinterAPI.isConnected()) {
            console.log("printer is not connected, connecting before executing command...");
            // let's connect, then we'll print
            this.connect()
                    .then(() => {
                        this.qrCode(value);
                    })
                    .catch((e) => {
                        console.log(e);
                    });
            return;
        } else {
            let command = this.encoder
                    .qrcode(value) // works on black printer
                    // .barcode("1234567890123", "ean13", 8) // works approx on black printer
                    .newline()
                    .newline()
                    .newline()
                    .encode();
            BluetoothPrinterAPI.print(command);
        }
    }

    barcodeEan13(value) {
        if (!BluetoothPrinterAPI.isConnected()) {
            console.log("printer is not connected, connecting before executing command...");
            // let's connect, then we'll print
            this.connect()
                    .then(() => {
                        this.barcodeEan13(value);
                    })
                    .catch((e) => {
                        console.log(e);
                    });
            return;
        } else {
            let command = this.encoder
                    .barcode(value, "ean13", 60) // works on black printer
                    .newline()
                    .newline()
                    .newline()
                    .encode();
            BluetoothPrinterAPI.print(command);
        }
    }

    // first connect to printer then execute this command
    image(imageUrl) {
        if (!BluetoothPrinterAPI.isConnected()) {
            console.log("printer is not connected, connecting before executing command...");
            // let's connect, then we'll print
            this.connect()
                    .then(() => {
                        this.image(imageUrl);
                    })
                    .catch((e) => {
                        console.log(e);
                    });
            return;
        } else {
            // TODO : sortir cette condition à l'extérieur de cette fonction
            if (_imageUrl !== "") {
                imageUrl = _imageUrl;
            }
            var imgElement = document.createElement("img");
            imgElement.src = imageUrl;
            // samples:
            // "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABAAQMAAACQp+OdAAABhGlDQ1BJQ0MgcHJvZmlsZQAAKJF9kT1Iw1AUhU9TpUUqDnYQcchQnSyIijpKKxbBQmkrtOpg8tI/aNKQpLg4Cq4FB38Wqw4uzro6uAqC4A+Iq4uToouUeF9SaBHjDY98nHfP4b37AKFZZarZMwGommWkEzExl18VA6/w0RdCELMSM/VkZjELz/q6p16quyjP8u77s/qVgskAn0g8z3TDIt4gntm0dM77xGFWlhTic+Jxgw5I/Mh12eU3ziWHBZ4ZNrLpOHGYWCx1sdzFrGyoxNPEEUXVKF/Iuaxw3uKsVuusfU5+w1BBW8lwndYIElhCEimIkFFHBVVYiNJfI8VEmvZjHv5hx58il0yuChg5FlCDCsnxg7/B79maxalJNykUA3pfbPtjFAjsAq2GbX8f23brBPA/A1dax19rAnOfpDc6WuQIGNgGLq47mrwHXO4AQ0+6ZEiO5KclFIvA+xk9Ux4YvAX61ty5tfdx+gBkaVbLN8DBITBWoux1j3sHu+f2b097fj9RrHKap9jQYAAAAAZQTFRFAAAA////pdmf3QAAAAlwSFlzAAALEwAACxMBAJqcGAAAAAd0SU1FB+cBAQwKHzy001QAAACMSURBVCjPY/j/gwEI/v9n+P8BxKiHMeyBjM//////B2I8hjMOMDDIgRkNDAx8MAYbmDH///9j1GD0wxhwk4GW8lnCnGGIndHwwIINypDAzbDhMyRojgRBcxo/4DQHbgVec6BOxdD+EcSwRI6LHzAGFCAzzv9j76cx4ziMAYwCeTDjAShpgBgfQO76DwCz8mvZztcoQQAAAABJRU5ErkJggg=="; // POS in black and white 64x64, working on black printer
            // "https://upload.wikimedia.org/wikipedia/fr/thumb/6/6d/Logo_hps_0.png/640px-Logo_hps_0.png";

            const ENCODER = this.encoder;
            imgElement.setAttribute("crossOrigin", ""); // warning, this code may trigger a CORS error if image is not accessible
            imgElement.onload = function () {
                // console.log("width: " + imgElement.width);
                // console.log("height: " + imgElement.height);
                var height, width;
                if (imgElement.height > imgElement.width) {
                    // set height = 64 and calculate width accordingly
                    height = 64;
                    width = (imgElement.width * height) / imgElement.height;
                    width = Math.ceil(width / 8.0) * 8; // width has to be a multiple of 8
                } else {
                    // set width = 416 and calculate height accordingly
                    width = 416;
                    height = (imgElement.height * width) / imgElement.width;
                    height = Math.ceil(height / 8.0) * 8; // height has to be a multiple of 8
                }
                let command = ENCODER
                        .image(imgElement, width, height, 'atkinson')
                        .newline()
                        .newline()
                        .newline()
                        .encode();
                BluetoothPrinterAPI.print(command);
            };
        }
    }
}