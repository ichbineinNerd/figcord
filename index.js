require('dotenv').config();

const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const https = require('https');
const path = require('path');
const Discord = require('discord.js');
const client = new Discord.Client();

fs.access(process.env.FONTCACHEDIR, e => {
    if (e && e.code === 'ENOENT') {
        console.log('font cache dir does not exist, creating...');
        fs.mkdir(process.env.FONTCACHEDIR, () => {});
    }
});

client.once('ready', () => {
    console.log('Ready!');
});

client.login(process.env.TOKEN);


const accessFigFont = function accessFigFont(name, callback) {
    const downloadFigFont = function downloadFigFont(name2, cb) {
        const download = function download(url, cb2) {
            const ishttps = url.startsWith('https://');
            const ishttp = url.startsWith('http://');

            if (!ishttp && !ishttps)
                return cb2(null, 'ERR_PROTOCOL');

            const lib = ishttps ? https : http;

            lib.get(url, res => {
                let length = 0;
                let body = '';

                let aborted = false;
                res.on('data', d => {
                    body += d;
                    length += d.length;

                    if (length > parseInt(process.env.FIGFONTSIZELIMIT)) {
                        aborted = true;
                        res.destroy();
                    }
                });
                res.on('end', () => {
                    if (aborted)
                        return cb2(null, 'ERR_FILETOOLARGE');
                    else if (!body.startsWith('flf2a'))
                        return cb2(null, 'ERR_NOTAFONT');
                    else
                        return cb2(body, null);
                })
            });
        };

        if (name2.startsWith('http://') || name2.startsWith('https://'))
            return download(name2, cb);
        else {
            if (!name2.endsWith('.flf'))
                name2 = name2 + '.flf';

            const url = 'http://www.figlet.org/fonts/' + name2;
            return download(url, cb);
        }
    };
    const accessCachedFigFont = function accessCachedFigFont(name2, cb) {
        fs.readFile(path.join(process.env.FONTCACHEDIR, crypto.createHash('sha512').update(name2).digest('hex')), (err, data) => {
            if (err)
                return cb(null, null);
            if (Buffer.isBuffer(data))
                return cb(data.toString(), null);
            else
                return cb(data, null);
        });
    };
    const cacheFigFont = function cacheFigFont(name2, data, cb) {
        const p = path.join(process.env.FONTCACHEDIR, crypto.createHash('sha512').update(name2).digest('hex'));
        fs.access(p, e => {
            if (e) {
                fs.writeFile(p, data, (e, d) => {
                    if (e)
                        cb(null, null);
                    else {
                        cb(true, null);
                        setTimeout(() => {
                            fs.unlink(p, () => {})
                        }, process.env.CACHETIMEOUT * 1000)
                    }
                });
            }
        });
    };

    if (process.env.FONTCACHEDIR === '') {
        return downloadFigFont(name, callback);
    }else if (process.env.FONTCACHEDIR.startsWith('NONEW|')) {
        if (process.env.FONTCACHEDIR.length <= 'NONEW|'.length) {
            return callback(null, 'ERR_INVALIDCACHECONFIG');
        }
        accessCachedFigFont(name, data => {
            if (data === null)
                return downloadFigFont(name, callback);
            else
                return callback(data, null);
        })
    }else {
        accessCachedFigFont(name, data => {
            if (data === null)
                downloadFigFont(name, (data, e) => {
                    if (e)
                        return callback(null, e);
                    cacheFigFont(name, data, () => {
                        callback(data);
                    })
                });
            else
                return callback(data, null);
        });
    }
};
const parseFigFont = function parseFigFont(data) {
    let lines = data.split('\r\n');
    if (lines.length === 1)
        lines = lines[0].split('\n');

    const metaData = lines[0].split(' ');

    if (metaData[0].substr(0, metaData[0].length - 1) !== 'flf2a' || metaData.length < 6 || metaData.length > 9)
        return { error: 'ERR_INVALID' };

    let height, hardBlank, numCommentLines; //quite some options (relating to smushing) are ignored, due to this renderer only being able to render the FIGcharacters in full-width layout

    try {
        hardBlank = metaData[0].substr(metaData[0].length - 1);

        height = parseInt(metaData[1]);
        if (parseInt(metaData[2]) > height || parseInt(metaData[2]) < 1)
            throw new Error();

        numCommentLines = parseInt(metaData[5]);
        oldLayout = parseInt(metaData[4]);
        if (metaData.length >= 7)
            if (metaData[6] !== '0')
                throw new Error();

        if (metaData.length >= 8)
            fullLayout = parseInt(metaData[7]);

    }catch (Error) {
        return { error: 'ERR_INVALID' };
    }

    let chars = {};

    let isInUnicode = false;

    let charIndex = ' ';
    lines = lines.slice(numCommentLines + 1);
    while (lines.length > 1) {
        let thisChar = '';
        let ending = '';
        if (isInUnicode)
            charIndex = 'none';
        for (let charLine = 0; charLine < height; charLine++) {
            const l = lines[0];
            ending = l[l.length-1];

            if (isInUnicode && charIndex === 'none') {
                charLine--;
                const numStr = l.split(' ', 2)[0];
                let tmp = -1;
                if (numStr.toLowerCase().startsWith('0x')) {
                    tmp = parseInt(numStr.substr(2).toLowerCase(), 16);
                }else if (numStr.toLowerCase().startsWith('0')) {
                    tmp = parseInt(numStr.substr(1), 8);
                }else {
                    tmp = parseInt(numStr, 10);
                }
                if (tmp < 0)
                    charIndex = 'none2';
                if (tmp === 0) {
                    charIndex = 'default';
                }
                else
                    charIndex = String.fromCharCode(tmp);
                lines = lines.slice(1);
                continue;
            }

            if (charLine === height - 1) {
                thisChar += l.split('$').join(' ');
                if (thisChar.endsWith(ending + ending))
                    thisChar = thisChar.substr(0, thisChar.length - 2);
                else
                    thisChar = thisChar.substr(0, thisChar.length - 1);
            }else {
                thisChar += l.split('$').join(' ').substr(0, l.length - 1) + '\n';
            }
            lines = lines.slice(1);
        }
        if (charIndex !== 'none2')
            chars[charIndex] = thisChar.split('\n');
        if (!isInUnicode) {
            if (charIndex.charCodeAt(0) < 126)
                charIndex = String.fromCharCode(charIndex.charCodeAt(0) + 1);
            else if (charIndex === '~')
                charIndex = 'Ä';
            else if (charIndex === 'Ä')
                charIndex = 'Ö';
            else if (charIndex === 'Ö')
                charIndex = 'Ü';
            else if (charIndex === 'Ü')
                charIndex = 'ä';
            else if (charIndex === 'ä')
                charIndex = 'ö';
            else if (charIndex === 'ö')
                charIndex = 'ü';
            else if (charIndex === 'ü')
                charIndex = 'ß';
            else if (charIndex === 'ß') {
                isInUnicode = true;
            }
        }
    }

    chars['height'] = height;
    return chars;
};

const figlifyText = function figlifyText(text, font) {
    let output = '';

    let lineLen = 0;
    let charsDone = 0;
    while (charsDone !== text.length) {
        for (let y = 0; y < font.height; y++) {
            for (let x = 0; x < text.length; x++) {
                lineLen += font[text[x]][y].length;
                if (lineLen > process.env.FIGGEDTEXTWRAP) {
                    lineLen -= font[text[x]][y].length;
                    break;
                }

                output += font[text[x]][y];
                if (y === font.height - 1)
                    charsDone++;
            }
            output += '\n';
            lineLen = 0;
        }
        text = text.slice(charsDone);
        charsDone = 0;
        output += '\n\n';
    }
    return output;
};

const splitMessage = function splitMessage(message) {
    let messages = [];
    let messageIndex = 0;
    let lines = message.split('\n');

    messages.push('');

    while (lines.length > 0) {
        if (messages[messageIndex].length + lines[0].length <= 1990) {
            messages[messageIndex] += lines[0] + '\n';
            lines = lines.slice(1);
        }else {
            messages[messageIndex] = messages[messageIndex].substr(0, messages[messageIndex].length - 1);
            messageIndex++;
            messages.push('');
        }
    }
    return messages;
};

const processCommand = function processCommand(message) {
    const noPrefix = message.content.substring(process.env.PREFIX.length);
    const command = noPrefix.split(' ', 2)[0];
    const arguments = noPrefix.split(' ').slice(1);

    if (command === (process.env.FIGLIFYSIMPLE || 'enlarge'))
        accessFigFont('standard', (d, e) => {
            if (e)
                message.channel.send('unfortunately, an error occured while trying to enlarge your text: ' + e);
            else
                message.channel.send(splitMessage(figlifyText(arguments.join(' '), parseFigFont(d))).map(m => '```' + m + '```')).forEach(msg => message.channel.send(msg));
        });
    else if (command === (process.env.FIGLIFY_WITHFONT || 'enlarge-font'))
        accessFigFont(arguments[0], (d, e) => {
            if (e)
                message.channel.send('unfortunately, an error occured while trying to enlarge your text: ' + e);
            else
                splitMessage(figlifyText(arguments.slice(1).join(' '), parseFigFont(d))).map(m => '```' + m + '```').forEach(msg => message.channel.send(msg));
        });

};

client.on('message', m => {
    if (m.content.startsWith(process.env.PREFIX)) {
        try {
            processCommand(m)
        }catch (e) {
            console.error(e);
        }
    }
});
