const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const pino = require('pino');

module.exports = async (req, res) => {
    // Fungsi agar Vercel merespon HTTP request
    res.status(200).send('Bot WhatsApp Serverless Vercel sedang berjalan...');

    try {
        const { state, saveCreds } = await useMultiFileAuthState('./tmp_auth');
        const { version } = await fetchLatestBaileysVersion();

        const sock = makeWASocket({
            version,
            logger: pino({ level: 'silent' }),
            auth: state,
            printQRInTerminal: true
        });

        sock.ev.on('connection.update', (update) => {
            const { connection, lastDisconnect } = update;
            if (connection === 'close') {
                const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
                if (shouldReconnect) {
                    console.log('Menghubungkan ulang...');
                }
            } else if (connection === 'open') {
                console.log('Bot berhasil terhubung ke WhatsApp!');
            }
        });

        sock.ev.on('creds.update', saveCreds);

        const antiLinkGroups = new Set();

        sock.ev.on('messages.upsert', async ({ messages }) => {
            const m = messages[0];
            if (!m.message || m.key.fromMe) return;

            const remoteJid = m.key.remoteJid;
            const isGroup = remoteJid.endsWith('@g.us');
            const body = m.message.conversation || m.message.extendedTextMessage?.text || '';
            const sender = m.key.participant || remoteJid;

            // 1. Anti-Link
            if (isGroup && antiLinkGroups.has(remoteJid)) {
                const urlRegex = /(https?:\/\/[^\s]+|www\.[^\s]+|[a-zA-Z0-9-]+\.[a-zA-Z]{2,})/gi;
                if (urlRegex.test(body)) {
                    await sock.sendMessage(remoteJid, { delete: m.key });
                    await sock.sendMessage(remoteJid, { 
                        text: `_Woi @${sender.split('@')[0]}, dilarang kirim link sembarangan!_`,
                        mentions: [sender]
                    });
                    return;
                }
            }

            if (!body.startsWith('.')) return;
            const args = body.trim().split(/ +/);
            const command = args[0].toLowerCase();
            const text = args.slice(1).join(' ');

            let groupMetadata = null, participants = [], groupAdmins = [], isBotAdmin = false, isSenderAdmin = false;
            if (isGroup) {
                try {
                    groupMetadata = await sock.groupMetadata(remoteJid);
                    participants = groupMetadata.participants;
                    groupAdmins = participants.filter(p => p.admin !== null).map(p => p.id);
                    isBotAdmin = groupAdmins.includes(sock.user.id.split(':')[0] + '@s.whatsapp.net');
                    isSenderAdmin = groupAdmins.includes(sender);
                } catch (e) {}
            }

            // Commands
            if (command === '.ping') {
                await sock.sendMessage(remoteJid, { text: '_Pong! Bot aktif di Vercel Serverless._' }, { quoted: m });
            } 
            else if (command === '.h') {
                if (!isGroup) return;
                let members = participants.map(p => p.id);
                await sock.sendMessage(remoteJid, { text: text || 'Panggilan untuk semua!', mentions: members });
            }
            else if (command === '.gc') {
                if (!isGroup || !isSenderAdmin || !isBotAdmin) return;
                if (args[1] === 'closed') {
                    await sock.groupSettingUpdate(remoteJid, 'announcement');
                    await sock.sendMessage(remoteJid, { text: '_mampus group closed!!_' });
                } else if (args[1] === 'open') {
                    await sock.groupSettingUpdate(remoteJid, 'not_announcement');
                    await sock.sendMessage(remoteJid, { text: '_group telah dibuka!!_' });
                }
            }
            else if (command === '.kick') {
                if (!isGroup || !isSenderAdmin || !isBotAdmin) return;
                let target = m.message.extendedTextMessage?.contextInfo?.participant || m.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
                if (target) {
                    await sock.groupParticipantsUpdate(remoteJid, [target], 'remove');
                    await sock.sendMessage(remoteJid, { text: '_member bandel berhasil di kick!!_' });
                }
            }
        });

    } catch (err) {
        console.error("Error bot:", err);
    }
};
