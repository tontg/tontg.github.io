// author : Gilles Reant
// license: Mozilla Public License version 2.0 https://www.mozilla.org/en-US/MPL/2.0/

function generateEventFile(eventParams) {
    if (eventParams.t && eventParams.s && eventParams.e) {
        var startTime = eventParams.s.replaceAll("-", "");
        startTime = startTime.replace(":", "") + "00";
        var endTime = eventParams.e.replaceAll("-", "");
        endTime = endTime.replace(":", "") + "00";
        // TODO dt stamp from new Date()
        // TODO : support encoding in title and description ; test with Kanji
        // TODO : set min date for start
        // TODO : when exiting start, set min date for end
        // TODO : remove name "calendar" & say "event" instead
        // TODO : generate UID on form (input hidden) before submit
        if (eventParams.u) {
            if (!eventParams.u.includes("://")) {
                // we can't be sure the website will work with HTTPS, so we'll assume HTTP
                eventParams.u = "http://" + eventParams.u;
            }
        } else {
            eventParams.u = window.location.href;
        }
        // TODO : generate dTSTAMP
        var fileContent = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//tontg.github.io//1-click event//EN
CALSCALE:GREGORIAN
BEGIN:VEVENT
UID:${uuidv4().toUpperCase()}
DTSTAMP:20210105T102650Z
SUMMARY:${eventParams.t}
DTSTART:${startTime}
DTEND:${endTime}
`;
        if (eventParams.d) {
            // TODO : fix bug with multiline_description
            fileContent += `DESCRIPTION;ENCODING=QUOTED-PRINTABLE:${encodeURIComponent(eventParams.d)}
`;
        }
        fileContent += `URL:${eventParams.u}
`;
        if (eventParams.l) {
            // TODO : test X-APPLE-STRUCTURED-LOCATION
            fileContent += `LOCATION:${eventParams.l.replaceAll("+", " ")}
X-APPLE-STRUCTURED-LOCATION;VALUE=URI;X-ADDRESS="36 Boulevard de la Bastille, 75012 Paris, France";X-APPLE-RADIUS=141.1750506089954;X-APPLE-REFERENCEFRAME=1;X-TITLE="Cafe de la Presse":geo:48.850322,2.368959
`;
        }
        fileContent += `END:VEVENT
END:VCALENDAR`;
        return fileContent;
    } else {
        return null;
    }
}

function preparePage() {
    // prepare form
    var now = new Date();
    if (!document.getElementById("start_time").value) {
        document.getElementById("start_time").value = now.toISOString().substr(0, 16);
    }
    if (!document.getElementById("end_time").value) {
        now.setHours(now.getHours() + 1);
        document.getElementById("end_time").value = now.toISOString().substr(0, 16);
    }

    // if event in query, display it
    var eventParams = getQueryDict();
    var eventFileContent = generateEventFile(eventParams);
    if (eventFileContent !== null) {
        displayEvent(eventParams);
        var downloadLink = document.getElementById("downloadLink");
        downloadLink.setAttribute("href", URL.createObjectURL(new Blob([eventFileContent], {type: "text/calendar"})));
        downloadLink.setAttribute("download", eventParams.t + ".ics");
        setTimeout(function () {
            downloadLink.click();
        }, 3000);
    } else {
        document.getElementById("event_title").focus();
    }
}

function displayEvent(event) {
    document.getElementById("dispEvent").style.display = "initial";
    document.getElementById("dispTitle").textContent = event.t.replaceAll("+", " ");
    document.title = event.t.replaceAll("+", " ") + " \u2013 1-click event";
    document.querySelector('meta[property="og:title"]').setAttribute("content", document.title);
    // TODO : replace og:image
    document.querySelector('meta[property="og:description"]').setAttribute("content", `event from ${event.s} to ${event.e}`);
    document.getElementById("dispTime").textContent = `from ${event.s} to ${event.e}`;
    if (event.d) {
        document.getElementById("dispDescription").textContent = event.d.replaceAll("+", " ");
    } else {
        document.getElementById("dispDescription").style.display = "none";
    }
    if (event.l) {
        document.getElementById("dispLocation").textContent = event.l.replaceAll("+", " ");
        // using Google Maps ; alternative with OpenStreetMap Nomatim https://nominatim.openstreetmap.org/ui/search.html?q=
        document.getElementById("dispLocation").href = "https://www.google.com/maps/search/" + event.l;
    } else {
        document.getElementById("dispLocation").style.display = "none";
    }
    if (event.u) {
        document.getElementById("dispUrl").textContent = new URL(event.u).hostname;
        document.getElementById("dispUrl").href = event.u;
    } else {
        document.getElementById("dispUrl").style.display = "none";
    }
    if (navigator.share) {
        document.getElementById("dispShare").title = "add " + event.t + " to your calendar";
    } else {
        document.getElementById("dispShare").style.display = "none";
    }
}

function onFormSubmit(form) {
    // remove form optional attributes if they are empty
    Array.from(form.getElementsByClassName("optional")).forEach(
            function (element) {
                if (!element.value) {
                    element.removeAttribute("name");
                }
            }
    );
    return true;
}

// TODO : replace element with element.title
function share(element) {
    navigator.share({url: window.location.href, title: element.title, text: element.title});
}

function copyLinktoClipboard() {
    navigator.permissions.query({name: "clipboard-write"}).then(result => {
        if (result.state === "granted" || result.state === "prompt") {
            var copyText = window.location.href;
            // TODO : fix by adding input text unmodifiable
            // https://developer.mozilla.org/fr/docs/Mozilla/Add-ons/WebExtensions/interagir_avec_le_presse_papier
            copyText.select();
            document.execCommand("copy");
        }
    });
}

/**
 * https://stackoverflow.com/a/21210643 CC BY-SA 4.0 Peter Mortensen
 * modified by Gilles
 * TODO check encoding for specific chars ; replace +
 */
function getQueryDict() {
    var queryDict = {};
    location.search.substr(1).split("&").forEach(function (item) {
        queryDict[item.split("=")[0]] = decodeURIComponent(item.split("=")[1]);
    });
    return queryDict;
}

// https://stackoverflow.com/a/2117523 CC BY-SA 4.0 broofa
function uuidv4() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
        var r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

// https://stackoverflow.com/questions/294297/javascript-implementation-of-gzip
// LZW-compress a string
function lzw_encode(s) {
    var dict = {};
    var data = (s + "").split("");
    var out = [];
    var currChar;
    var phrase = data[0];
    var code = 256;
    for (var i = 1; i < data.length; i++) {
        currChar = data[i];
        if (dict[phrase + currChar] !== null) {
            phrase += currChar;
        } else {
            out.push(phrase.length > 1 ? dict[phrase] : phrase.charCodeAt(0));
            dict[phrase + currChar] = code;
            code++;
            phrase = currChar;
        }
    }
    out.push(phrase.length > 1 ? dict[phrase] : phrase.charCodeAt(0));
    for (var i = 0; i < out.length; i++) {
        out[i] = String.fromCharCode(out[i]);
    }
    return out.join("");
}

// Decompress an LZW-encoded string
function lzw_decode(s) {
    var dict = {};
    var data = (s + "").split("");
    var currChar = data[0];
    var oldPhrase = currChar;
    var out = [currChar];
    var code = 256;
    var phrase;
    for (var i = 1; i < data.length; i++) {
        var currCode = data[i].charCodeAt(0);
        if (currCode < 256) {
            phrase = data[i];
        } else {
            phrase = dict[currCode] ? dict[currCode] : (oldPhrase + currChar);
        }
        out.push(phrase);
        currChar = phrase.charAt(0);
        dict[code] = oldPhrase + currChar;
        code++;
        oldPhrase = phrase;
    }
    return out.join("");
}

function testCompress() {
    var str = "t=hoho+&s=2021-01-09T09%3A34&e=2021-01-09T10%3A34&d=hehe";
    console.log("str");
    console.log(str);
    var base64 = atob(str);
    console.log("base64");
    console.log(base64);
    var compressed = lzw_encode(str);
    console.log("compressed");
    console.log(compressed);
    var deflated = lzw_decode(compressed);
    console.log("deflated");
    console.log(deflated);
}

testCompress();