# SHIVNEE-г GitHub болон Cloudflare руу гаргах

Бүх зүйл Cloudflare дээр ажиллана:

```
Хөтөч ──https──▶ Cloudflare Worker ──▶ Static файлууд (dist/: вэб апп)
      ──wss /ws─▶                  └─▶ Durable Object "Relay" (WebSocket + SQLite)
```

* **Worker** нь вэб аппын файлуудыг өгнө. `/ws` болон `/health` хүсэлтийг Durable Object руу дамжуулна.
* **Durable Object** бол дэлхий даяар нэг л ширхэг "Relay" юм. Бүх WebSocket холболтыг барина.
  Нийтийн түлхүүр болон битүүмжилсэн дугтуйг өөрийн SQLite санд хадгална.
  Хоосон холболтуудад төлбөр гарахгүй (Hibernation API).
* 30 хоногоос дээш хүргэгдээгүй дугтуйг цаг тутам устгана.

## 0. Шаардлага

* Node.js 20.19+
* Cloudflare бүртгэл (үнэгүй). Durable Objects (SQLite) Workers Free төлөвлөгөөнд ажилладаг.
* GitHub бүртгэл

Шинэ хамаарал (wrangler) нэмэгдсэн тул эхлээд:

```powershell
cd D:\Developments\E2EE_Chat
npm install
```

## 1. Локалаар Cloudflare хувилбарыг турших (заавал биш)

```powershell
npm run cf:dev
```

`http://localhost:8787` нээгдэнэ. Энэ нь яг Cloudflare-ийн runtime (workerd) дээр ажилладаг.
Өгөгдөл нь `.wrangler/` хавтсанд хадгалагдана (git-д орохгүй).

## 2. GitHub руу push хийх

GitHub дээр **хоосон** repo үүсгэнэ (README, .gitignore, license нэмэлгүй). Жишээ нь `shivnee`.

```powershell
cd D:\Developments\E2EE_Chat
git init -b main
git add .
git commit -m "SHIVNEE: E2EE chat + Cloudflare relay"
git remote add origin https://github.com/<ТАНЫ-НЭР>/shivnee.git
git push -u origin main
```

`node_modules`, `dist`, `.wrangler`, `server/data` git-д орохгүй (`.gitignore`).

## 3. Cloudflare руу байршуулах — арга А: командын мөрөөс (хамгийн хялбар)

```powershell
npx wrangler login      # хөтөч нээгдэж Cloudflare-д зөвшөөрөл өгнө
npm run deploy          # typecheck + build + wrangler deploy
```

Дууссаны дараа `https://shivnee.<таны-subdomain>.workers.dev` гэсэн хаяг гарна. Шалгах:

* `https://…workers.dev/health` хаягаар `{"ok":true,...}` гарах ёстой.
* Аппыг нээгээд шинэ identity үүсгэнэ. Апп нь ижил домэйн дээрх `/ws`-д автоматаар холбогдоно.

## 4. Арга Б: GitHub-аас автоматаар байршуулах (Workers Builds)

1. Cloudflare Dashboard → **Workers & Pages** → **Create** → **Import a repository**.
2. GitHub-аа холбоод `shivnee` repo-г сонгоно.
3. Тохиргоо:
   * Build command: `npm run build`
   * Deploy command: `npx wrangler deploy`
4. Үүнээс хойш `main` руу push хийх бүрт автоматаар шинэчлэгдэнэ.

> Worker-ийн нэр `wrangler.jsonc` дахь `"name": "shivnee"`-тэй ижил байх ёстой.

## 5. Өөрийн домэйн (заавал биш)

Dashboard → таны Worker → **Settings → Domains & Routes → Add → Custom domain**.
Жишээ нь `chat.example.com` гэж нэмнэ. HTTPS, WSS автоматаар ажиллана.

## 6. Анхаарах зүйлс

* **Нэг Durable Object.** Бүх хэрэглэгч нэг relay-д холбогдоно. Энэ нь хэдэн мянган идэвхтэй
  хэрэглэгч хүртэл хангалттай. Түүнээс их бол хэрэглэгчээр нь хэд хэдэн object-д хуваах хэрэгтэй.
* **Хавсралт 0.5 MB хүртэл.** Cloudflare-ийн WebSocket мессеж 1 MiB хүртэл байдаг.
  Шифрлэлт ба base64 нь хэмжээг томруулдаг.
* **Migration.** `wrangler.jsonc` дахь `migrations` (`v1`, `new_sqlite_classes`)-ийг устгаж,
  өөрчилж болохгүй. Ирээдүйд class нэмбэл шинэ tag (`v2`) нэмнэ.
* **Өгөгдөл устгах.** Worker-ийг устгавал Durable Object-ийн өгөгдөл (нийтийн түлхүүр,
  хүлээгдэж буй дугтуй) устана. Хэрэглэгчдийн мессежийн түүх тэдний төхөөрөмж дээр хэвээр үлдэнэ.
  Гэхдээ дахин бүртгүүлэх шаардлагатай болно.
* **Аюулгүй байдлын header-үүд** `public/_headers` дотор байна (CSP, X-Frame-Options гэх мэт).
* **Лог:** Dashboard → Worker → **Logs**, эсвэл `npx wrangler tail`.
  Лог дээр зөвхөн техникийн үйл явдал гарна. Мессежийн агуулга сервер дээр хэзээ ч байдаггүй.

## 7. Node хувилбар хэвээр бий

Cloudflare ашиглахгүй бол `npm start` нь бүгдийг нэг Node процесс дээр (порт 8787) ажиллуулна.
Хоёр хувилбар нэг дүрмийн кодыг (`server/relay.ts`) хуваалцдаг.
