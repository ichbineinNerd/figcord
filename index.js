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
        fs.mkdir(process.env.FONTCACHEDIR);
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

    let charIndex = 32;
    lines = lines.slice(numCommentLines + 1);
    while (lines.length > 1) {
        let thisChar = '';
        let ending = '';
        if (isInUnicode)
            charIndex = -1;
        for (let charLine = 0; charLine < height; charLine++) {
            const l = lines[0];
            ending = l[l.length-1];

            if (isInUnicode && charIndex === -1) {
                charLine--;
                const numStr = l.split(' ', 2)[0];
                if (numStr.toLowerCase().startsWith('0x')) {
                    charIndex = parseInt(numStr.substr(2).toLowerCase(), 16);
                }else if (numStr.toLowerCase().startsWith('0')) {
                    charIndex = parseInt(numStr.substr(1), 8);
                }else {
                    charIndex = parseInt(numStr, 10);
                }
            }

            if (charLine === height - 1) {
                thisChar += l.replace(hardBlank, ' ');
                if (thisChar.endsWith(ending + ending))
                    thisChar = thisChar.substr(0, thisChar.length - 2);
                else
                    thisChar = thisChar.substr(0, thisChar.length - 1);
            }else {
                thisChar += l.replace(hardBlank, ' ').substr(0, l.length - 1) + '\n';
            }
            lines = lines.slice(1);
        }
        chars[String.fromCharCode(charIndex)] = thisChar.split['\n'];
        if (!isInUnicode) {
            if (charIndex < 126)
                charIndex++;
            else if (charIndex === 126)
                charIndex = 196;
            else if (charIndex === 196)
                charIndex = 214;
            else if (charIndex === 214)
                charIndex = 220;
            else if (charIndex === 220)
                charIndex = 228;
            else if (charIndex === 228)
                charIndex = 246;
            else if (charIndex === 246)
                charIndex = 252;
            else if (charIndex === 252)
                charIndex = 223;
            else if (charIndex === 223) {
                isInUnicode = true;
            }
        }
    }
};

const figlifyText = function figlifyText(text, font) {

};

const processCommand = function processCommand(message) {
    const noPrefix = message.content.substring(process.env.PREFIX.length);
    const command = noPrefix.split(' ', 2)[0];
    const arguments = noPrefix.split(' ').slice(1);

    if (command === (process.env.FIGLIFYSIMPLE || 'enlarge'))
        message.channel.send(`\`\`\`${figlifyText(arguments.join(' '), 'standard')}\`\`\``);
};

client.on('message', m => {
    if (m.content.startsWith(process.env.PREFIX))
        processCommand(m)
});
