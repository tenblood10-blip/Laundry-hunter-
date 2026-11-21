// SHAKA LAUNDRY - AUTOMATION QRIS XENDIT
// Bos GAK PERLU cek mutasi lagi. Xendit yang kasih tau otomatis.
const functions = require('firebase-functions');
const admin = require('firebase-admin');
admin.initializeApp();
const db = admin.firestore();

// ⚠️ GANTI INI DENGAN SECRET KEY XENDIT LU!
// Ambil di: Xendit Dashboard > Settings > Developers > API Keys > Secret Key
// Contoh: xnd_development_xxx atau xnd_production_xxx
const XENDIT_SECRET = "GANTI_DENGAN_SECRET_KEY_XENDIT_LU";
const AUTH = "Basic " + Buffer.from(XENDIT_SECRET + ":").toString('base64');

// 1. KURIR MINTA QRIS DINAMIS - Dipanggil dari kurir.html
exports.buatQRIS = functions.https.onCall(async (data, context) => {
  const { orderId, total, nama } = data;
  if (!orderId || !total) throw new functions.https.HttpsError('invalid-argument', 'orderId & total wajib');

  const res = await fetch("https://api.xendit.co/qr_codes", {
    method: "POST",
    headers: { "Authorization": AUTH, "Content-Type": "application/json" },
    body: JSON.stringify({
      external_id: orderId,
      type: "DYNAMIC",
      callback_url: "https://us-central1-shaka-laundry.cloudfunctions.net/xenditWebhook",
      amount: Math.round(total),
      metadata: { nama_pelanggan: nama || "", orderId }
    })
  });
  const qr = await res.json();
  if (!qr.qr_string) throw new functions.https.HttpsError('internal', 'Gagal bikin QR Xendit: ' + JSON.stringify(qr));

  await db.collection("orders").doc(orderId).update({
    qrId: qr.id,
    qrUrl: qr.qr_string,
    statusBayar: "MENUNGGU PEMBAYARAN",
    verifikasiBos: false,
    qrDibuatPada: new Date().toLocaleString('id-ID')
  });
  return { qrUrl: qr.qr_string, qrId: qr.id };
});

// 2. WEBHOOK - XENDIT KIRIM SINYAL KALO UANG UDAH MASUK
// INI YANG BIKIN OTOMATIS LUNAS TANPA BOS CEK MUTASI
exports.xenditWebhook = functions.https.onRequest(async (req, res) => {
  try {
    const data = req.body || {};
    const qrId = data.qr_code?.id || data.id || data.qr_code_id;
    const status = data.qr_code?.status || data.status;

    if (qrId && (status === "COMPLETED" || status === "PAID" || status === "SUCCEEDED")) {
      const snap = await db.collection("orders").where("qrId", "==", qrId).get();
      for (const docSnap of snap.docs) {
        await docSnap.ref.update({
          statusBayar: "LUNAS - OTOMATIS TERVERIFIKASI ✅",
          verifikasiBos: true,
          waktuLunas: new Date().toLocaleString('id-ID'),
          dibayarVia: "QRIS Xendit Otomatis"
        });
        console.log("✅ AUTO LUNAS:", docSnap.id);
      }
    }
    res.send("OK");
  } catch (e) {
    console.error("Webhook error:", e);
    res.send("OK");
  }
});
