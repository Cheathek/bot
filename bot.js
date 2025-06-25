const { Telegraf } = require('telegraf');
const axios = require('axios');
const crypto = require('crypto');
const fs = require('fs-extra');
const path = require('path');

const BOT_TOKEN = '7762199917:AAGimHdXulwYiVspij8Jwr_hNO7dctRiITk';
const YOUR_TELEGRAM_USER_ID = '5058242890'; // <- You can get this by talking to @userinfobot
const CHANNEL_USERNAME = '@wallpaper_yamiro'; // e.g. @myChannelName

const bot = new Telegraf(BOT_TOKEN);
const HASHES_FILE = path.join(__dirname, 'hashes.json');

// Load hashes from file
let fileHashes = new Set();
if (fs.existsSync(HASHES_FILE)) {
  try {
    const hashesArr = fs.readJsonSync(HASHES_FILE);
    fileHashes = new Set(hashesArr);
  } catch (e) {
    console.error('Failed to load hashes:', e);
  }
}

// Save hashes to file
function saveHashes() {
  fs.writeJsonSync(HASHES_FILE, Array.from(fileHashes));
}

async function downloadAndHash(fileLink, tempName) {
  const filePath = path.join(__dirname, 'temp', tempName);
  await fs.ensureDir('temp');
  const response = await axios({ url: fileLink, method: 'GET', responseType: 'stream' });
  const writer = fs.createWriteStream(filePath);
  response.data.pipe(writer);

  await new Promise((resolve, reject) => {
    writer.on('finish', resolve);
    writer.on('error', reject);
  });

  const fileBuffer = fs.readFileSync(filePath);
  const hash = crypto.createHash('sha256').update(fileBuffer).digest('hex');
  await fs.remove(filePath);
  return hash;
}

bot.on('channel_post', async (ctx) => {
  try {
    const message = ctx.channelPost;
    const file = message.photo
      ? message.photo[message.photo.length - 1]
      : message.document || message.video;

    if (!file) return; // Ignore non-media messages

    const fileId = file.file_id;
    const fileLink = await ctx.telegram.getFileLink(fileId);
    const hash = await downloadAndHash(fileLink.href, `${fileId}.tmp`);

    const messageId = message.message_id;
    const messageLink = `https://t.me/${CHANNEL_USERNAME.replace('@', '')}/${messageId}`;

    if (fileHashes.has(hash)) {
      await ctx.telegram.sendMessage(
        YOUR_TELEGRAM_USER_ID,
        `🚫 Duplicate detected: ${messageLink}`
      );
    } else {
      fileHashes.add(hash);
      saveHashes(); // Save after adding new hash
      console.log(`✅ New unique file stored. Hash: ${hash}`);
    }
  } catch (err) {
    console.error('Error in channel_post handler:', err);
  }
});

bot.launch();
console.log('🤖 Bot is monitoring channel for duplicates...');
