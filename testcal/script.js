/* global URL */

// author : Gilles Reant
// license: Mozilla Public License version 2.0 https://www.mozilla.org/en-US/MPL/2.0/

// loads the page with the appropriate content
function preparePage() {
    // prepare form
    var now = new Date();
    if (!document.getElementById("start_time").value) {
        document.getElementById("start_time").value = toISO8601Format(now);
    }
    document.getElementById("end_time").min = document.getElementById("start_time").value;
    if (!document.getElementById("end_time").value) {
        now.setHours(now.getHours() + 1);
        document.getElementById("end_time").value = toISO8601Format(now);
    }

    var eventParams = getQueryDict();
    // if event in query, display it
    if (eventParams.t && eventParams.s && eventParams.e) {
        var eventFileContent = generateEventFile(eventParams);
        displayEvent(eventParams);
        var downloadLink = document.getElementById("downloadLink");
        downloadLink.setAttribute("href", URL.createObjectURL(new Blob([eventFileContent], {type: "text/calendar"})));
        downloadLink.setAttribute("download", eventParams.t.replaceAll("+", "_") + ".ics");
        // TODO : add cookie with UUID to prevent from multiple auto-download
        setTimeout(function () {
            downloadLink.click();
        }, 3000);
    } else {
        document.getElementById("event_title").focus();
    }
}

function toISO8601Format(date) {
    return date.getFullYear() + "-" + (date.getMonth() + 1).toString().padStart(2, "0") + "-" + (date.getDate()).toString().padStart(2, "0") + "T" + date.getHours().toString().padStart(2, "0") + ":" + date.getMinutes().toString().padStart(2, "0");
}

// generates a iCalendar / vCalendar (.ics) file based on the event parameters
function generateEventFile(eventParams) {
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
            // we can't be sure the website will work with HTTPS, so we'll assume regular HTTP
            eventParams.u = "http://" + eventParams.u;
        }
    } else {
        eventParams.u = window.location.href;
    }
    // TODO : generate dTSTAMP
    // DTSTAMP:20210105T102650Z
    var fileContent = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//tontg.github.io//1-click event//EN
CALSCALE:GREGORIAN
BEGIN:VEVENT
UID:${uuidv4()}
DTSTAMP:${toISO8601Format(new Date()).replaceAll("-", "").replaceAll(":", "") + "00"}
SUMMARY:${eventParams.t.replaceAll("+", " ")}
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
        // TODO : fix X-APPLE-STRUCTURED-LOCATION
        /*fileContent += `LOCATION:${eventParams.l.replaceAll("+", " ")}
         X-APPLE-STRUCTURED-LOCATION;VALUE=URI;X-ADDRESS="36 Boulevard de la Bastille, 75012 Paris, France";X-APPLE-MAPKIT-HANDLE=;X-APPLE-RADIUS=141.1750506089954;X-APPLE-REFERENCEFRAME=1;X-TITLE="Cafe de la Presse":geo:48.850322,2.368959
         `;*/
        // TODO : on leave input location, Ajax call to https://nominatim.openstreetmap.org/search?q=1+avenue+des+champs+elysees+Paris&format=json and fill in the hidden geolocation parameter
        // + insert GEO vCalendar element
        // input.onblur
        // TODO : add proper support
        // fileContent += `LOCATION:36 Boulevard de la Bastille\\, 75012 Paris\\, France
        fileContent += `LOCATION:${eventParams.l.replaceAll(",", "\\,").replaceAll("+", " ")}
`;
        if (eventParams.g) {
            console.log("geolocation");
            console.log(eventParams.g);
            /*fileContent += `LOCATION:Cafe de la Presse\\n36 Boulevard de la Bastille\\, 75012 Paris\\, France
             X-APPLE-STRUCTURED-LOCATION;VALUE=URI;X-ADDRESS="36 Boulevard de la Bastille, 75012 Paris, France";X-APPLE-MAPKIT-HANDLE=;X-APPLE-RADIUS=141.1750506089954;X-APPLE-REFERENCEFRAME=1;X-TITLE="Cafe de la Presse":geo:48.850322,2.368959
             `;*/
            // TODO : add proper support
            // fileContent += `X-APPLE-STRUCTURED-LOCATION;VALUE=URI;X-ADDRESS="36 Boulevard de la Bastille, 75012 Paris, France";X-APPLE-MAPKIT-HANDLE=;X-APPLE-RADIUS=50;X-APPLE-REFERENCEFRAME=1;X-TITLE="":geo:${eventParams.g}
            fileContent += `X-APPLE-STRUCTURED-LOCATION;VALUE=URI;X-ADDRESS="${eventParams.l.replaceAll("+", " ")}";X-APPLE-MAPKIT-HANDLE=;X-APPLE-RADIUS=50;X-APPLE-REFERENCEFRAME=1;X-TITLE="":geo:${eventParams.g}
`;
        }
    }
    fileContent += `END:VEVENT
END:VCALENDAR`;
    return fileContent;
}

// display event data in the webpage content
function displayEvent(event) {
    document.getElementById("dispEvent").style.display = "initial";
    document.getElementById("dispTitle").textContent = event.t.replaceAll("+", " ");
    document.title = event.t.replaceAll("+", " ") + " \u2013 1-click event";
    document.querySelector('meta[property="og:title"]').setAttribute("content", document.title);
    // TODO : replace og:image
    // console.log("event.s: " + event.s);
    var startDateTime = new Date(event.s);
    var endDateTime = new Date(event.e);
    // set calendar icon content
    document.getElementById("weekday").textContent = startDateTime.toLocaleDateString(navigator.language, {weekday: 'long'});
    document.getElementById("month").textContent = startDateTime.toLocaleDateString(navigator.language, {month: 'long'});
    document.getElementById("day").textContent = startDateTime.toLocaleDateString(navigator.language, {day: 'numeric'});
    // TODO : use <time> element
    if (startDateTime.getFullYear() === endDateTime.getFullYear() &&
            startDateTime.getMonth() === endDateTime.getMonth() &&
            startDateTime.getDate() === endDateTime.getDate()) {
        // same day
        document.querySelector('meta[property="og:description"]').setAttribute("content", `event on ${new Intl.DateTimeFormat(navigator.language, {dateStyle: 'full'}).format(startDateTime)} from ${startDateTime.toLocaleTimeString(navigator.language, {hour: '2-digit', minute: '2-digit'})} to ${endDateTime.toLocaleTimeString(navigator.language, {hour: '2-digit', minute: '2-digit'})}`);
        document.getElementById("dispTime").textContent = `${new Intl.DateTimeFormat(navigator.language, {dateStyle: 'full'}).format(startDateTime)} from ${startDateTime.toLocaleTimeString(navigator.language, {hour: '2-digit', minute: '2-digit'})} to ${endDateTime.toLocaleTimeString(navigator.language, {hour: '2-digit', minute: '2-digit'})}`;
    } else {
        document.querySelector('meta[property="og:description"]').setAttribute("content", `event from ${startDateTime.toLocaleString(navigator.language)} to ${endDateTime.toLocaleString(navigator.language)}`);
        document.getElementById("dispTime").textContent = `from ${startDateTime.toLocaleString(navigator.language)} to ${endDateTime.toLocaleString(navigator.language)}`;
    }

    // fill in Google Calendar URL
    document.getElementById("gCalendarLink").href = generateGoogleCalendarUrl(event.t, event.s, event.e, event.d, event.l);
    if (event.d) {
        document.getElementById("dispDescription").textContent = event.d.replaceAll("+", " ");
    } else {
        document.getElementById("dispDescription").parentNode.style.display = "none";
    }
    if (event.l) {
        document.getElementById("dispLocation").textContent = event.l.replaceAll("+", " ");
        // using Google Maps ; alternative with OpenStreetMap Nomatim https://nominatim.openstreetmap.org/ui/search.html?q=
        document.getElementById("dispLocation").href = "https://www.google.com/maps/search/" + event.l;
    } else {
        document.getElementById("dispLocation").parentNode.style.display = "none";
    }
    if (event.g) {
        // display iframe map
        var lat = parseFloat(event.g.substring(0, event.g.indexOf(',')));
        var lon = parseFloat(event.g.substring(event.g.indexOf(',') + 1));
        // TODO : add CSS to iframe map
        document.getElementById("eventMap").src = `https://www.openstreetmap.org/export/embed.html?bbox=${lon - 0.002}%2C${lat - 0.002}%2C${lon + 0.002}%2C${lat + 0.002}&marker=${lat}%2C${lon}`;
        document.getElementById("eventMap").style.display = "initial";
    }
    if (event.u) {
        // TODO : if URL is github.io, don't display it, only in vCalendar file
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

function generateGoogleCalendarUrl(text, startDate, endDate, details, location) {
    // https://www.google.com/calendar/render?action=TEMPLATE
    // &text=Your+Event+Name
    // &dates=20140127T224000Z/20140320T221500Z
    // &details=For+details,+link+here:+http://www.example.com
    // &location=Waldorf+Astoria,+301+Park+Ave+,+New+York,+NY+10022
    // &sf=true&output=xml
    var link = "https://www.google.com/calendar/render?action=TEMPLATE";
    if (text) {
        link += "&text=" + text;
    }
    if (startDate && endDate) {
        link += "&dates=" + startDate.replaceAll("-", "").replaceAll(":", "") + "/" + endDate.replaceAll("-", "").replaceAll(":", "");
    }
    if (details) {
        link += "&details=" + details.replaceAll("\n", "%0D%0A");
    }
    if (location) {
        link += "&location=" + location;
    }
    link += "&sf=true&output=xml";
    return link;
}

function onFormSubmit(form) {
    // remove form optional attributes if they are empty
    // TODO : replace selector by "not required"
    Array.from(form.getElementsByClassName("optional")).forEach(
            function (element) {
                if (!element.value) {
                    element.removeAttribute("name");
                }
            }
    );
    return true;
}

function updateEndTime(startTime) {
    document.getElementById('end_time').min = startTime;
    // check if endTime is valid
    var dStartTime = new Date(startTime);
    var dEndTime = new Date(document.getElementById('end_time').value);
    if ((dEndTime - dStartTime) < 0) {
        // we need to fix endTime, set as start time + 1 hour
        dStartTime.setHours(dStartTime.getHours() + 1);
        document.getElementById("end_time").value = toISO8601Format(dStartTime);
    }
}

// TODO : fix icon & text as in https://css-tricks.com/on-the-web-share-api/
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
    }).catch(ex => {
// probably not supported, e.g. on Firefox ("clipboard-write" not in enum)
    });
}

/**
 * uses OpenStreetMap and Nominatim API
 */
function updateGeolocation(address) {
    var xhttp = new XMLHttpRequest();
    xhttp.onreadystatechange = function () {
        var ok;
        if (this.readyState === 4 && this.status === 200) {
            // console.log("AJAX response received:");
            // console.log(this.responseText);
            var response = JSON.parse(this.responseText);
            if (response.length >= 1) {
                ok = true;
                var lat = parseFloat(response[0].lat);
                var lon = parseFloat(response[0].lon);
                document.getElementById("geolocation").value = `${lat},${lon}`;
                // TODO : upload bounding box in form too
                var boundingBox = response[0].boundingbox;
                // TODO : add CSS to iframe map
                document.getElementById("formMap").src = `https://www.openstreetmap.org/export/embed.html?bbox=${boundingBox[2]}%2C${boundingBox[0]}%2C${boundingBox[3]}%2C${boundingBox[1]}&marker=${lat}%2C${lon}`;
                document.getElementById("formMap").style.display = "initial";
            } else {
                ok = false;
            }
        } else {
            ok = false;
        }
        if (!ok) {
            document.getElementById("geolocation").value = "";
            document.getElementById("formMap").src = "";
            document.getElementById("formMap").style.display = "none";
        }
    };
    // test URL: https://nominatim.openstreetmap.org/search?format=json&q=1+rue+de+Paris,+Strasbourg
    xhttp.open("GET", "https://nominatim.openstreetmap.org/search?format=json&q=" + address, true);
    xhttp.send();
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

/**
 * https://stackoverflow.com/a/2117523 CC BY-SA 4.0 broofa
 */
function uuidv4() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
        var r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16).toUpperCase();
    });
}