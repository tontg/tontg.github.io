// tests NFC
// inspiration: https://web.dev/nfc/
// https://caniuse.com/webnfc
// must enable flag in chrome android enable-experimental-web-platform-features
// specs: https://w3c.github.io/web-nfc/

// TODO : write a listener
// TODO : mettre `${}` partout

class NfcManager {
    constructor(logElement) {
        this.logElement = logElement;
        if ('NDEFReader' in window) {
            this.reader = new NDEFReader();
        } else {
            this.log("NFC not supported (no NDEFReader object)");
        }
    }

    log = function (text) {
        console.log(text);
        this.logElement.value += text + "\n";
    }

    readNdefTag = function () {
        this.log("reading tag...");
        this.reader.scan().then(() => {
            this.log("Tag scan started successfully.");
            this.reader.onerror = () => {
                this.log("Cannot read data from the NFC tag. Try another one?");
            };
            this.reader.onreading = event => {
                const message = event.message;
                this.log(`nbRecords:    ${message.records.length}`);
                for (const record of message.records) {
                    this.log("record:");
                    this.log(record);
                    this.log(`Record type:  ${record.recordType}`);
                    this.log("MIME type:    " + record.mediaType);
                    this.log("Record id:    " + record.id);
                    switch (record.recordType) {
                        case "text":
                            // TODO: Read text record with record data, lang, and encoding.
                            this.log("tag is text");
                            var text = ab2str(record.data.buffer);
                            this.log("text is " + text); // TODO fix
                            break;
                        case "url":
                            this.log("tag is URL");
                            // TODO : replace with
                            //       const decoder = new TextDecoder();
                            // console.log(`URL: ${decoder.decode(record.data)}`);
                            var url = ab2str(record.data.buffer);
                            this.log(`URL is ${url}`);
                            if (confirm(`do you want to open ${url} in new tab?`)) {
                                window.open(url, "_blank");
                            }
                            break;
                        case "mime":
                            this.log("tag is mime");
                            this.log("media type is " + record.mediaType);
                            if (record.mediaType.startsWith("image/")) {
                                // TODO : test
                                this.log("media is image");
                                var img = document.createElement('img');
                                img.src = "data:" + record.mediaType + ";base64," + record.data.buffer.toString('base64');
                                document.getElementById('imgContainer').appendChild(img);
                            }
                            break;
                        default:
                        // TODO: Handle other records with record data.
                        // TODO : support image
                    }
                }
            };
        }).catch(error => {
            this.log(`Error! Scan failed to start: ${error}.`);
        });
    }

    writeNdefTag = function (text) {
        this.log("writing tag...");
        // const ndef = new NDEFReader(); // TODO : move as instance variable
        var writer = new NDEFWriter();
        // this.reader
        writer.write({records: [{
                    recordType: "text",
                    data: text
                }]})
                .then(() => {
                    this.log("Message written.");
                })
                .catch(error => {
                    this.log(`Write failed :-( try again: ${error}.`);
                });
    }
}

/**
 * array buffer to string
 * https://developers.google.com/web/updates/2012/06/How-to-convert-ArrayBuffer-to-and-from-String
 * @param {ArrayBuffer} character buffer encoded in 8 bits
 * @return {String} */
function ab2str(buf) {
    return String.fromCharCode.apply(null, new Uint8Array(buf));
}