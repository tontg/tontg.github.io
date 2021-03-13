function loadFile() {
    var queryDict = getQueryDict();
    if (queryDict.d) {
        var downloadLink = document.getElementById("downloadLink");
        downloadLink.setAttribute("href", queryDict.d);
        const fileName = queryDict.n ? queryDict.n : "file";
        downloadLink.setAttribute("download", fileName);
        setTimeout(function () {
            downloadLink.click();
        }, 3000);
        downloadLink.innerHTML = "download " + fileName;
        if (queryDict.d.startsWith("data:image")) {
            document.getElementById("thumbnail").src = queryDict.d;
        } else {
            document.getElementById("thumbnail").style.display = "none";
        }
    } else {
        // hide link & thumbnail
        document.getElementById("downloadLink").style.display = "none";
        document.getElementById("thumbnail").style.display = "none";
    }
}

// https://stackoverflow.com/a/57272491 CC BY-SA 4.0 https://stackoverflow.com/users/3062525/%d0%94%d0%bc%d0%b8%d1%82%d1%80%d0%b8%d0%b9-%d0%92%d0%b0%d1%81%d0%b8%d0%bb%d1%8c%d0%b5%d0%b2
const toBase64 = file => new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = () => resolve(reader.result);
        reader.onerror = error => reject(error);
    });
async function loadFileElement(fileElement) {
    const fileName = fileElement.value.substring(fileElement.value.lastIndexOf("\\") + 1);
    var fileData = await toBase64(fileElement.files[0]);
    window.location.href = window.location.origin + window.location.pathname + "?n=" + fileName + "&d=" + fileData;
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