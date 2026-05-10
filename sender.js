const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const screenshot = require('screenshot-desktop');
const { PNG } = require('pngjs');
const pixelmatch = require('pixelmatch').default || require('pixelmatch');
const si = require('systeminformation');
const fs = require('fs').promises;
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, { cors: { origin: "*" } });

let lastImgData = null;
let TARGET_DIR = 'C:\\'; // 初期ディレクトリ（環境に合わせて変更してください）

// --- ファイル操作関数 ---
async function broadcastFileList(target = io) {
    try {
        const items = await fs.readdir(TARGET_DIR, { withFileTypes: true });
        const files = items.map(item => ({
            name: item.name,
            isDir: item.isDirectory()
        }));
        target.emit('file-list', { files, dir: TARGET_DIR });
    } catch (err) {
        console.error("ディレクトリ読み取り失敗:", err);
    }
}

io.on('connection', async (socket) => {
    console.log('Client connected');
    await broadcastFileList(socket);

    // ディレクトリ変更
    socket.on('change-dir', async (newDir) => {
        TARGET_DIR = (newDir === "..") ? path.dirname(TARGET_DIR) : path.join(TARGET_DIR, newDir);
        await broadcastFileList();
    });

    // ファイル読み込み
    socket.on('request-file', async (filename) => {
        try {
            const filePath = path.join(TARGET_DIR, filename);
            const content = await fs.readFile(filePath, 'utf-8');
            socket.emit('file-data', { filename, content });
        } catch (err) {
            console.error("読込失敗:", err);
            socket.emit('error', "ファイルを開けませんでした");
        }
    });

    // ファイル保存
    socket.on('save-file', async (data) => {
        try {
            const filePath = path.join(TARGET_DIR, data.filename);
            await fs.writeFile(filePath, data.content, 'utf-8');
            console.log(`保存完了: ${data.filename}`);
            await broadcastFileList(); // リストを最新の状態に更新
        } catch (err) {
            console.error("保存失敗:", err);
        }
    });
});

// --- システム・画面監視 (既存) ---
setInterval(async () => {
    try {
        const imgBuffer = await screenshot({ format: 'png' });
        const currentImg = PNG.sync.read(imgBuffer);
        if (!lastImgData || pixelmatch(lastImgData.data, currentImg.data, null, currentImg.width, currentImg.height, { threshold: 0.5 }) > (currentImg.width * currentImg.height * 0.005)) {
            io.emit('screen-data', imgBuffer.toString('base64'));
            lastImgData = currentImg;
        }
        const load = await si.currentLoad();
        const mem = await si.mem();
        io.emit('status-data', {
            avgLoad: load.currentLoad.toFixed(1),
            cores: load.cpus.map(c => c.load.toFixed(1)),
            memUsedGB: (mem.active / 1024 / 1024 / 1024).toFixed(2),
            memTotalGB: (mem.total / 1024 / 1024 / 1024).toFixed(2),
            memPercent: (mem.active / mem.total * 100).toFixed(1)
        });
    } catch (e) {}
}, 1000);

server.listen(3000, () => console.log('Server running on port 3000'));