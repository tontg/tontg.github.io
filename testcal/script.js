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

function generateVCalendarFile(eventParams) {
    if (eventParams.t && eventParams.s && eventParams.e) {
        var startTime = eventParams.s.replaceAll("-", "");
        startTime = startTime.replace(":", "") + "00";
        var endTime = eventParams.e.replaceAll("-", "");
        endTime = endTime.replace(":", "") + "00";
        // TODO dt stamp from new Date()
        // TODO : support encoding ; test with Kanji
        // TODO : set min date for start
        // TODO : when exiting start, set min date for end
        // TODO : remove name "calendar" & say "event" instead
        // TODO : generate UID on form (input hidden) before submit
        // fixing URL
        if (eventParams.u) {
            if (!eventParams.u.includes("://")) {
                // we can't be sure the website will work with HTTPS, so we'll assume HTTP
                eventParams.u = "http://" + eventParams.u;
            }
        } else {
            eventParams.u = window.location.href;
        }
        /*return `BEGIN:VCALENDAR
         VERSION:2.0
         PRODID:-//reant.net//1-click event//EN
         CALSCALE:GREGORIAN
         BEGIN:VEVENT
         UID:${uuidv4().toUpperCase()}
         DTSTAMP:20210105T102650Z
         SUMMARY:${eventParams.t}
         DTSTART:${startTime}
         DTEND:${endTime}
         DESCRIPTION:${eventParams.d}
         URL:${eventParams.u}
         LOCATION:${eventParams.d}
         END:VEVENT
         END:VCALENDAR`;*/
        return `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//ABC Corporation//NONSGML My Product//EN
BEGIN:VTODO
DTSTAMP:19980130T134500Z
SEQUENCE:2
UID:uid4@example.com
ORGANIZER:mailto:unclesam@example.com
ATTENDEE;PARTSTAT=ACCEPTED:mailto:jqpublic@example.com
DUE:19980415T000000
STATUS:NEEDS-ACTION
SUMMARY:Submit Income Taxes
BEGIN:VALARM
ACTION:AUDIO
TRIGGER:19980403T120000Z
ATTACH;FMTTYPE=audio/basic:http://example.com/pub/audio-files/ssbanner.aud
REPEAT:4
DURATION:PT1H
END:VALARM
END:VTODO
END:VCALENDAR`;
    } else {
        return null;
    }
}

// https://stackoverflow.com/a/2117523 CC BY-SA 4.0 broofa
function uuidv4() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
        var r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
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

    // if event, prepare page
    var eventParams = getQueryDict();
    var eventFileContent = generateVCalendarFile(eventParams);
    if (eventFileContent !== null) {
        displayEvent(eventParams);
        var downloadLink = document.getElementById("downloadLink");
        downloadLink.setAttribute("href", URL.createObjectURL(new Blob([eventFileContent], {type: "text/calendar"})));
        downloadLink.setAttribute("download", eventParams.t + ".ics");
        setTimeout(function () {
            downloadLink.click();
        }, 3000);
    } else {
        document.getElementById("dispEvent").style.display = "none";
        // TODO : add? document.getElementById("event_title").autofocus = true;
    }
}

function displayEvent(event) {
    document.getElementById("dispTitle").textContent = event.t.replaceAll("+", " ");
    document.title = event.t.replaceAll("+", " ") + " \u2013 1-click event";
    // TODO from XXX to YYY
    document.getElementById("dispStartTime").textContent = event.s;
    document.getElementById("dispEndTime").textContent = event.e;
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
    Array.from(form.getElementsByClassName("optionnal")).forEach(
            function (element) {
                if (!element.value) {
                    element.removeAttribute("name");
                }
            }
    );
    return true;
}

function share(element) {
    navigator.share({url: window.location.href, title: element.title, text: element.title});
}

function copyLinktoClipboard() {
    navigator.permissions.query({name: "clipboard-write"}).then(result => {
        if (result.state === "granted" || result.state === "prompt") {
            var copyText = window.location.href;
            // TODO : fix by adding input text unmodifiable
            copyText.select();
            document.execCommand("copy");
        }
    });
}

preparePage();