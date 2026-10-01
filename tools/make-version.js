/* version.json を作る: テレビ版の「最新版に更新」が、ここに並んだファイルを取り込む。
   使い方: node tools/make-version.js          … 書き出す（公開の前に毎回）
           node tools/make-version.js --check  … いまのファイルと一致するかだけ確かめる（ビルド時） */
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const root = path.join(__dirname, '..');
const ls = (dir, ext) => fs.readdirSync(path.join(root, dir)).filter((f) => f.endsWith(ext)).sort().map((f) => (dir === '.' ? f : dir + '/' + f));
// APK に内蔵するものと同じ並び（.github/workflows/tv.yml の cp と合わせる）
const list = ['index.html', 'manifest.webmanifest', 'cloud-config.js'].concat(ls('.', '.png'), ls('css', '.css'), ls('js', '.js'));
const v = (/id="ver">([^<]*)</.exec(fs.readFileSync(path.join(root, 'index.html'), 'utf8')) || [])[1] || '';
const body = JSON.stringify({ v, files: list.map((p) => ({ path: p, sha256: crypto.createHash('sha256').update(fs.readFileSync(path.join(root, p))).digest('hex') })) }, null, 1) + '\n';
const out = path.join(root, 'version.json');
if (process.argv[2] === '--check') {
  if (!fs.existsSync(out) || fs.readFileSync(out, 'utf8') !== body) { console.error('version.json が古いままです。node tools/make-version.js を実行してから公開してください。'); process.exit(1); }
  console.log('version.json OK (' + v + ', ' + list.length + ' files)');
} else {
  fs.writeFileSync(out, body);
  console.log('version.json: ' + v + ', ' + list.length + ' files');
}
