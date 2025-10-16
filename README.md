Yoklama Sistemi
================

Basit ve mobil uyumlu yoklama uygulaması. Eğitmen Excel yükler, ders ve hafta seçer; sistem QR üretir. Öğrenci QR ile gidip öğrenci numarasını girerek yoklama verir. 14 hafta için XLSX/CSV dışa aktarım desteklenir.

Özellikler
- Excel yükleme: `student_id`, `name` kolonları
- 1-14 hafta seçimi, ders bazlı oturum
- QR üretimi (2 saat geçerli)
- Öğrenci sayfası: öğrenci no ile yoklama
- XLSX/CSV dışa aktarım (W1..W14 sütunları)

Kurulum
1. Node 18+ kurulu olmalı.
2. Proje dizini:
   ```bash
   cd yoklama_sistemi
   npm install
   ```
3. Çalıştırma:
   ```bash
   npm run dev   # geliştirme, hot-reload
   # veya
   npm start     # prod
   ```
4. Tarayıcıdan: `http://localhost:3000`

Kullanım
- Eğitmen: `/instructor` → Ders adı, hafta (1-14), Excel dosyası yükle → QR görüntüle
- Öğrenci: QR → `/ogrenci_yoklama` → Öğrenci no gir → Yoklama kaydı
- Dışa aktarım: `/instructor` altındaki formdan ders adı girip `xlsx`/`csv` seç

Excel Formatı
```
student_id,name
201812345,Ali Yılmaz
201812346,Ayşe Demir
```

Notlar
- Oturum kodu 2 saat sonra süre aşımına düşer (kodda değiştirilebilir).
- Aynı ders ve hafta için yeni QR üretmek eskisini günceller.
- Öğrenci listesi tekrar yüklendiğinde mevcut öğrenciler güncellenir ve kaydı olmayanlar eklenir.

Lisans
MIT


