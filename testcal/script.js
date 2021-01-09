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
            // TODO : test X-APPLE-STRUCTURED-LOCATION ; doesn't work (don't know why)
            /*fileContent += `LOCATION:${eventParams.l.replaceAll("+", " ")}
             X-APPLE-STRUCTURED-LOCATION;VALUE=URI;X-ADDRESS="36 Boulevard de la Bastille, 75012 Paris, France";X-APPLE-MAPKIT-HANDLE=;X-APPLE-RADIUS=141.1750506089954;X-APPLE-REFERENCEFRAME=1;X-TITLE="Cafe de la Presse":geo:48.850322,2.368959
             `;*/
            fileContent += `LOCATION:Cafe de la Presse\\n36 Boulevard de la Bastille\\, 75012 Paris\\, F
 rance
X-APPLE-STRUCTURED-LOCATION;VALUE=URI;X-ADDRESS="36 Boulevard de la Basti
 lle, 75012 Paris, France";X-APPLE-MAPKIT-HANDLE=CAESwAIIrk0Q7Lmt/4mCuvMy
 GhIJjlS9V9dsSEARAAAA4KDzAkAigwEKBkZyYW5jZRICRlIaDsOObGUtZGUtRnJhbmNlKgVQ
 YXJpczIFUGFyaXM6BTc1MDEyQgkxMnRoIGFyci5SGEJvdWxldmFyZCBkZSBsYSBCYXN0aWxs
 ZVoCMzZiGzM2IEJvdWxldmFyZCBkZSBsYSBCYXN0aWxsZYoBCTEydGggYXJyLioSQ2Fmw6kg
 ZGUgbGEgUHJlc3NlMhszNiBCb3VsZXZhcmQgZGUgbGEgQmFzdGlsbGUyCzc1MDEyIFBhcmlz
 MgZGcmFuY2U4L1pPCiQI7Lmt/4mCuvMyEhIJjlS9V9dsSEARAAAA4KDzAkAYrk2QAwGiHyYI
 7Lmt/4mCuvMyGhoKEkNhZsOpIGRlIGxhIFByZXNzZRAAKgJmcg==;X-APPLE-RADIUS=141.
 1750506089954;X-APPLE-REFERENCEFRAME=1;X-TITLE="Cafe de la Presse":geo:4
 8.850322,2.368959
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