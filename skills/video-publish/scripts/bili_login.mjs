'use strict';

// video/bili_login.mjs — B站扫码登录一体化脚本
// 用法: node video/bili_login.mjs [二维码输出路径] [cookies输出路径]
// 流程: 官方扫码API生成二维码 → 轮询扫码结果 → TV授权链换access_token → 生成biliup-rs可用的cookies.json
// 注意: 二维码有效期约180秒；脚本需在用户扫码确认后才能完成

import fs from 'fs';
import crypto from 'crypto';
import path from 'path';
import { execFileSync } from 'child_process';

const QR_OUT = process.argv[2] || path.join('video', 'out', 'bilibili_login_qr.png');
const COOKIE_OUT = process.argv[3] || path.join('video', 'out', 'cookies.json');
const UA = 'Mozilla/5.0 (X11; Linux x86_64; rv:38.0) Gecko/20100101 Firefox/38.0 Iceweasel/38.2.1 BiliApp';

// biliup-rs AppKeyStore::BiliTV（B站公开常量，与其源码一致）
const APP_KEY = '4409e2ce8ffd12b8';
const APPSEC = '59b43e04ad6965f34319062b478f83dd';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// B站App API签名：sign = md5(queryString + appsec)，最终body = qs + '&sign=' + md5
const signedBody = (params) => {
  const qs = Object.entries(params).map(([k, v]) => `${k}=${v}`).join('&');
  const md5 = crypto.createHash('md5').update(qs + APPSEC).digest('hex');
  return `${qs}&sign=${md5}`;
};

const post = (url, body, extraHeaders = {}) =>
  fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': UA, ...extraHeaders },
    body,
  }).then((r) => r.json());

async function main() {
  // ---------- 第1步：官方扫码API生成二维码 ----------
  const gen = await fetch('https://passport.bilibili.com/x/passport-login/web/qrcode/generate').then((r) => r.json());
  if (gen.code !== 0) throw new Error('生成二维码失败: ' + JSON.stringify(gen));
  const { url: qrUrl, qrcode_key: qrKey } = gen.data;

  fs.mkdirSync(path.dirname(QR_OUT), { recursive: true });
  execFileSync('qrencode', ['-s', '12', '-m', '4', '-o', QR_OUT, qrUrl]);
  console.log(`二维码已生成: ${QR_OUT}`);
  console.log(`请用B站App扫码并在App内确认登录（有效期约180秒）`);

  // ---------- 第2步：轮询扫码结果，拿web cookie ----------
  let cookies = null;
  for (let i = 0; i < 90; i++) {
    await sleep(2000);
    const res = await fetch(`https://passport.bilibili.com/x/passport-login/web/qrcode/poll?qrcode_key=${qrKey}`);
    const setCookies = res.headers.getSetCookie?.() || [];
    const data = (await res.json()).data;
    if (data.code === 0) {
      cookies = {};
      for (const line of setCookies) {
        const m = line.match(/^([^=]+)=([^;]*)/);
        if (m) cookies[m[1]] = m[2];
      }
      console.log(`扫码成功，cookie字段: ${Object.keys(cookies).join(',')}`);
      break;
    }
    if (data.code === 86038) throw new Error('二维码已过期，请重跑本脚本');
    if (i % 5 === 4) console.log(`等待扫码中... ${((i + 1) * 2) / 60}分钟`);
  }
  if (!cookies) throw new Error('等待超时，请重跑本脚本');

  // ---------- 第3步：TV授权链，用web cookie换access_token ----------
  // 3.1 申请TV授权码
  let r = await post(
    'https://passport.bilibili.com/x/passport-tv-login/qrcode/auth_code',
    signedBody({ appkey: APP_KEY, local_id: '0', ts: String(Math.floor(Date.now() / 1000)) }),
  );
  if (r.code !== 0) throw new Error('auth_code失败: ' + JSON.stringify(r).slice(0, 200));
  const authCode = r.data.auth_code;

  // 3.2 用web cookie确认授权（确认后poll立即成功）
  r = await post(
    'https://passport.bilibili.com/x/passport-tv-login/h5/qrcode/confirm',
    new URLSearchParams({ auth_code: authCode, csrf: cookies.bili_jct, scanning_type: '3' }).toString(),
    { Cookie: `SESSDATA=${cookies.SESSDATA}; bili_jct=${cookies.bili_jct}` },
  );
  if (r.code !== 0) throw new Error('confirm失败: ' + JSON.stringify(r).slice(0, 300));

  // 3.3 轮询拿token（cookie_info + token_info）
  const payload = { appkey: APP_KEY, auth_code: authCode, local_id: '0', ts: String(Math.floor(Date.now() / 1000)) };
  let ok = null;
  for (let i = 0; i < 10; i++) {
    r = await post('https://passport.bilibili.com/x/passport-tv-login/qrcode/poll', signedBody(payload));
    if (r.code === 0) { ok = r.data; break; }
    await sleep(1500);
  }
  if (!ok) throw new Error('poll失败: ' + JSON.stringify(r).slice(0, 200));

  // ---------- 第4步：构造biliup-rs的LoginInfo（cookie_info/token_info/platform为必需字段） ----------
  const loginInfo = {
    cookie_info: ok.cookie_info,
    sso: [],
    token_info: ok.token_info,
    platform: 'BiliTV',
    mid: ok.mid,
    expires_in: ok.expires_in,
  };
  fs.mkdirSync(path.dirname(COOKIE_OUT), { recursive: true });
  fs.writeFileSync(COOKIE_OUT, JSON.stringify(loginInfo, null, 2));
  console.log(`登录完成，biliup-rs凭据已写入: ${COOKIE_OUT}`);
  console.log(`mid: ${ok.mid}`);
  console.log(`投稿时在该文件所在目录执行 biliup upload ...（biliup默认读取CWD的cookies.json）`);
}

main().catch((e) => { console.error('FAIL:', e.message); process.exit(1); });
