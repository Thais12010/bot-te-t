require('dotenv').config();

const crypto = require('crypto');
const {
    Client, GatewayIntentBits, REST, Routes, Events,
    SlashCommandBuilder, EmbedBuilder, MessageFlags
} = require('discord.js');
const { PROVIDERS, enabledProviders } = require('./providers');
const store = require('./store');

// ========== CẤU HÌNH ==========
const { DISCORD_TOKEN, DISCORD_CLIENT_ID, DISCORD_GUILD_ID } = process.env;
if (!DISCORD_TOKEN || !DISCORD_CLIENT_ID) {
    console.error('❌ Thiếu DISCORD_TOKEN hoặc DISCORD_CLIENT_ID trong .env');
    process.exit(1);
}

const list = (v) => (v || '').split(',').map(s => s.trim()).filter(Boolean);
const ADMIN_IDS = new Set(list(process.env.ADMIN_IDS));
const ALLOWED_IDS = new Set(list(process.env.ALLOWED_USER_IDS));
const COOLDOWN_MS = (parseInt(process.env.COOLDOWN_SECONDS, 10) || 5) * 1000;

const MMO_BASE_URL = process.env.MMO_BASE_URL || 'https://jeuwiw36.github.io/mmo/?key=';
const KEY_LENGTH = parseInt(process.env.KEY_LENGTH, 10) || 7;
const CHARSETS = {
    full: 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*()-_=+[]{};:,.<>?/~',
    alphanumeric: 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',
    lowercase: 'abcdefghijklmnopqrstuvwxyz0123456789',
    uppercase: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',
    numbers: '0123456789'
};
const CHARSET = CHARSETS[process.env.KEY_CHARSET] || CHARSETS.full;

function randomKey(length = KEY_LENGTH) {
    let out = '';
    for (let i = 0; i < length; i++) out += CHARSET[crypto.randomInt(0, CHARSET.length)];
    return out;
}

const isAdmin = (id) => ADMIN_IDS.has(id);
const canUse = (id) => ALLOWED_IDS.size === 0 || ALLOWED_IDS.has(id) || isAdmin(id);
const ts = (ms) => Math.floor(ms / 1000);

// ========== ĐỊNH NGHĨA SLASH COMMAND ==========
function buildCommands() {
    const providers = enabledProviders();
    const choices = providers.map(p => ({ name: p.name, value: p.id }));

    const getlink = new SlashCommandBuilder()
        .setName('getlink')
        .setDescription('Tạo key mới và rút gọn thành link')
        .addStringOption(o => {
            o.setName('provider').setDescription('Nhà cung cấp rút gọn link');
            if (choices.length) o.addChoices(...choices);
            return o;
        })
        .addBooleanOption(o => o.setName('cong_khai').setDescription('Hiện kết quả cho cả kênh (mặc định: chỉ mình bạn thấy)'));

    const history = new SlashCommandBuilder()
        .setName('history').setDescription('Xem lịch sử link đã tạo')
        .addIntegerOption(o => o.setName('so_luong').setDescription('Số link muốn xem (1-15, mặc định 10)').setMinValue(1).setMaxValue(15));

    const stats = new SlashCommandBuilder().setName('stats').setDescription('Thống kê link của bạn');
    const providersCmd = new SlashCommandBuilder().setName('providers').setDescription('Danh sách nhà cung cấp đang bật');

    const settings = new SlashCommandBuilder()
        .setName('settings').setDescription('Xem / đổi cài đặt cá nhân')
        .addBooleanOption(o => o.setName('luu_lich_su').setDescription('Bật/tắt lưu lịch sử'))
        .addIntegerOption(o => o.setName('max_lich_su').setDescription('Số link lưu tối đa (10-1000)').setMinValue(10).setMaxValue(1000));

    const clearHistory = new SlashCommandBuilder().setName('clearhistory').setDescription('Xoá toàn bộ lịch sử của bạn');

    const admin = new SlashCommandBuilder()
        .setName('admin').setDescription('Lệnh quản trị (chỉ admin)')
        .addSubcommand(s => s.setName('stats').setDescription('Thống kê toàn bot'))
        .addSubcommand(s => s.setName('backup').setDescription('Backup toàn bộ user lên GitHub ngay'));

    return [getlink, history, stats, providersCmd, settings, clearHistory, admin].map(c => c.toJSON());
}

async function registerCommands() {
    const rest = new REST({ version: '10' }).setToken(DISCORD_TOKEN);
    const route = DISCORD_GUILD_ID
        ? Routes.applicationGuildCommands(DISCORD_CLIENT_ID, DISCORD_GUILD_ID)
        : Routes.applicationCommands(DISCORD_CLIENT_ID);
    await rest.put(route, { body: buildCommands() });
    console.log(`✅ Đã đăng ký slash command (${DISCORD_GUILD_ID ? 'server ' + DISCORD_GUILD_ID : 'global'})`);
}

// ========== HANDLER TỪNG LỆNH ==========
const lastUse = new Map();

async function cmdGetLink(i) {
    const providers = enabledProviders();
    if (!providers.length) {
        return i.reply({ flags: MessageFlags.Ephemeral, content: '❌ Chưa có provider nào được cấu hình token trong .env.' });
    }

    const wait = (lastUse.get(i.user.id) || 0) + COOLDOWN_MS - Date.now();
    if (wait > 0) {
        return i.reply({ flags: MessageFlags.Ephemeral, content: `⏳ Chờ ${Math.ceil(wait / 1000)}s nữa rồi thử lại.` });
    }

    const providerId = i.options.getString('provider') || providers[0].id;
    const provider = PROVIDERS[providerId];
    if (!provider || !provider.isEnabled()) {
        return i.reply({ flags: MessageFlags.Ephemeral, content: `❌ Provider "${providerId}" không tồn tại hoặc đang tắt.` });
    }

    lastUse.set(i.user.id, Date.now());
    const isPublic = i.options.getBoolean('cong_khai') === true;
    await i.deferReply(isPublic ? {} : { flags: MessageFlags.Ephemeral });

    const key = randomKey();
    const target = MMO_BASE_URL + encodeURIComponent(key);
    console.log(`[${i.user.id}][${providerId}] 🔑 ${key}`);

    let finalUrl;
    try {
        finalUrl = await provider.shorten(target);
    } catch (err) {
        lastUse.delete(i.user.id); // lỗi phía API thì không tính cooldown
        return i.editReply(`❌ Không thể rút gọn qua **${provider.name}**: ${err.message}`);
    }

    const user = store.getUser(i.user);
    store.addHistory(user, { provider: providerId, providerName: provider.name, url: finalUrl, time: Date.now() });
    store.triggerBackup(user.username);

    const embed = new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle('🔗 Link mới')
        .setDescription(finalUrl)
        .addFields({ name: 'Nhà cung cấp', value: provider.name, inline: true })
        .setTimestamp();
    return i.editReply({ embeds: [embed] });
}

async function cmdHistory(i) {
    const n = i.options.getInteger('so_luong') || 10;
    const user = store.getUser(i.user);
    if (!user.history.length) {
        return i.reply({ flags: MessageFlags.Ephemeral, content: user.settings.saveHistory ? 'Bạn chưa tạo link nào.' : 'Bạn đang tắt lưu lịch sử (`/settings`).' });
    }
    const lines = user.history.slice(0, n).map((h, idx) =>
        `**${idx + 1}.** ${h.providerName} · <t:${ts(h.time)}:R>\n${h.url}`);
    const embed = new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle(`📜 Lịch sử (${Math.min(n, user.history.length)}/${user.history.length})`)
        .setDescription(lines.join('\n\n').slice(0, 4000));
    return i.reply({ flags: MessageFlags.Ephemeral, embeds: [embed] });
}

async function cmdStats(i) {
    const user = store.getUser(i.user);
    const h = user.history;
    const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
    const byProvider = {};
    h.forEach(x => { byProvider[x.providerName] = (byProvider[x.providerName] || 0) + 1; });
    const max = Math.max(1, ...Object.values(byProvider));
    const bars = Object.entries(byProvider)
        .sort((a, b) => b[1] - a[1])
        .map(([name, c]) => `${name.padEnd(12)} ${'█'.repeat(Math.max(1, Math.round((c / max) * 12)))} ${c}`)
        .join('\n') || 'Chưa có dữ liệu';
    const embed = new EmbedBuilder()
        .setColor(0x57f287)
        .setTitle('📊 Thống kê của bạn')
        .addFields(
            { name: 'Tổng link đã lưu', value: String(h.length), inline: true },
            { name: '24 giờ qua', value: String(h.filter(x => x.time >= dayAgo).length), inline: true },
            { name: 'Theo provider', value: '```\n' + bars + '\n```' }
        );
    return i.reply({ flags: MessageFlags.Ephemeral, embeds: [embed] });
}

async function cmdProviders(i) {
    const ps = enabledProviders();
    const text = ps.length
        ? ps.map(p => `• **${p.name}** — ${p.description}`).join('\n')
        : 'Chưa có provider nào được bật.';
    return i.reply({ flags: MessageFlags.Ephemeral, content: text });
}

async function cmdSettings(i) {
    const user = store.getUser(i.user);
    const save = i.options.getBoolean('luu_lich_su');
    const max = i.options.getInteger('max_lich_su');
    let changed = false;
    if (save !== null) { user.settings.saveHistory = save; changed = true; }
    if (max !== null) {
        user.settings.maxHistory = max;
        user.history = user.history.slice(0, max);
        changed = true;
    }
    if (changed) store.triggerBackup(user.username);
    return i.reply({
        flags: MessageFlags.Ephemeral,
        content: `${changed ? '✅ Đã lưu.\n' : ''}⚙️ **Cài đặt hiện tại**\n• Lưu lịch sử: **${user.settings.saveHistory ? 'Bật' : 'Tắt'}**\n• Tối đa: **${user.settings.maxHistory}** link`
    });
}

async function cmdClearHistory(i) {
    const user = store.getUser(i.user);
    const n = user.history.length;
    user.history = [];
    store.triggerBackup(user.username);
    return i.reply({ flags: MessageFlags.Ephemeral, content: `🗑️ Đã xoá ${n} link khỏi lịch sử.` });
}

async function cmdAdmin(i) {
    if (!isAdmin(i.user.id)) return i.reply({ flags: MessageFlags.Ephemeral, content: '⛔ Chỉ admin mới dùng được lệnh này.' });
    const sub = i.options.getSubcommand();
    if (sub === 'stats') {
        const users = store.allUsers();
        const total = users.reduce((s, u) => s + u.history.length, 0);
        return i.reply({
            flags: MessageFlags.Ephemeral,
            content: `👥 User: **${users.length}**\n🔗 Link đã lưu: **${total}**\n💾 Backup GitHub: **${store.BACKUP_ENABLED ? 'Bật' : 'Tắt'}**\n🔌 Provider bật: **${enabledProviders().map(p => p.name).join(', ') || 'không có'}**`
        });
    }
    if (sub === 'backup') {
        if (!store.BACKUP_ENABLED) return i.reply({ flags: MessageFlags.Ephemeral, content: '⚠️ Backup đang tắt (thiếu GITHUB_TOKEN).' });
        await i.deferReply({ flags: MessageFlags.Ephemeral });
        const n = await store.backupAll();
        return i.editReply(`✅ Đã backup ${n} user.`);
    }
}

const HANDLERS = {
    getlink: cmdGetLink, history: cmdHistory, stats: cmdStats, providers: cmdProviders,
    settings: cmdSettings, clearhistory: cmdClearHistory, admin: cmdAdmin
};

// ========== CLIENT ==========
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isChatInputCommand()) return;
    const handler = HANDLERS[interaction.commandName];
    if (!handler) return;

    if (!canUse(interaction.user.id)) {
        return interaction.reply({ flags: MessageFlags.Ephemeral, content: '⛔ Bạn không có quyền dùng bot này.' });
    }
    try {
        await handler(interaction);
    } catch (err) {
        console.error(`Lỗi lệnh /${interaction.commandName}:`, err);
        const msg = { flags: MessageFlags.Ephemeral, content: '❌ Có lỗi xảy ra, thử lại sau.' };
        if (interaction.deferred || interaction.replied) interaction.editReply(msg.content).catch(() => {});
        else interaction.reply(msg).catch(() => {});
    }
});

client.once(Events.ClientReady, (c) => {
    console.log(`🤖 Bot online: ${c.user.tag}`);
    console.log(`🔌 Provider bật: ${enabledProviders().map(p => p.name).join(', ') || '(không có — kiểm tra .env)'}`);
});

(async () => {
    await store.init();
    await registerCommands();
    await client.login(DISCORD_TOKEN);
})().catch(err => { console.error('❌ Không khởi động được:', err); process.exit(1); });

process.on('unhandledRejection', (e) => console.error('unhandledRejection:', e));
