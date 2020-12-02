// tests NFC
// inspiration: https://web.dev/nfc/
// https://caniuse.com/webnfc
// must enable flag in chrome android enable-experimental-web-platform-features
// specs: https://w3c.github.io/web-nfc/

function readNdefTag() {
    if ('NDEFReader' in window) {
        const reader = new NDEFReader();
        reader.scan().then(() => {
            console.log("Tag scan started successfully.");
            reader.onerror = () => {
                console.log("Cannot read data from the NFC tag. Try another one?");
            };
            reader.onreading = event => {
                const message = event.message;
                console.log(`nbRecords:    ${message.records.length}`);
                for (const record of message.records) {
                    console.log("record:");//       " + record);
                    console.log(record);
                    console.log("Record type:  " + record.recordType);
                    console.log("MIME type:    " + record.mediaType);
                    console.log("Record id:    " + record.id);
                    switch (record.recordType) {
                        case "text":
                            // TODO: Read text record with record data, lang, and encoding.
                            break;
                        case "url":
                            console.log("tag is URL");
                            var url = ab2str(record.data.buffer);
                            if (confirm("do you want to open URL " + url + " in new tab?")) {
                                window.open(url, "_blank");
                            }
                            break;
                        default:
                        // TODO: Handle other records with record data.
                    }
                }
            };
        }).catch(error => {
            console.log(`Error! Scan failed to start: ${error}.`);
        });
    } else {
        console.log("NFC not supported (no NDEFReader object)");
    }
}

// https://developers.google.com/web/updates/2012/06/How-to-convert-ArrayBuffer-to-and-from-String
function ab2str(buf) {
  return String.fromCharCode.apply(null, new Uint16Array(buf));
}


// @deprecated
function testOpenNewTab() {
    var url = "https://google.com/";
    if (confirm("do you want to open URL " + url + " in new tab?")) {
        window.open(url, "_blank");
    }
}