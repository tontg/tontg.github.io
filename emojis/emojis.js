// emojis

var emojis = [
{"title": "smileys", "elements": ["😅", "😆", "😏", "😲", "😮","🤔", "🙄", "😁","😓", "🥲", "🤨","😊", "😳", "🫢", "🫣", "🫡", "🫤", "🥹","🥳", "🎉", "🤦‍♂️", "🤷‍♂️", ]},
{"title": "hand", "elements": ["🤞", "🙏","💪","🤝","👌", "👍","🫵"]},
{"title": "ponctuation", "elements": ["⚠️", "✔️", "❌","🛈", "·", "É", "À", "¿", "≠", "•", "🇲🇦", "🇫🇷", "➜", "↔", "–", "…", "Ç", "“”", "×"]},
{"title": "work", "elements": ["📬", "📅", "⌛"]}
];

function loadContent() {
    var container = document.getElementById("container");
    emojis.forEach(emojiGroup => {
	    var title = document.createElement("h3");
        title.innerHTML = emojiGroup.title;
        container.appendChild(title);
        emojiGroup.elements.forEach(emoji => {
            var li = document.createElement("span");
            var input = document.createElement("input");
            input.setAttribute("type", "text");
            input.setAttribute("class", "emoji");
            input.setAttribute("value", emoji);
            input.setAttribute("id", emoji);
            li.appendChild(input);
            var button = document.createElement("button");
            button.setAttribute("onclick", "copyText('" + emoji + "')");
            button.innerHTML = emoji;
            li.appendChild(button);
            container.appendChild(li);
        });
    });
}

function copyText(elementId) {
    var copyText = document.getElementById(elementId);
    copyText.select();
    document.execCommand("copy");
    var span = document.createElement("span");
    span.innerHTML = "copied";
    copyText.nextSibling.parentNode.insertBefore(span, copyText.nextSibling.nextSibling); // not clean, but... :)
}