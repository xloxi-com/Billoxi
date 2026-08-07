import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const TEMPLATE_LANGUAGES = [
  "sq",
  "ar",
  "eu",
  "be",
  "bs",
  "bg",
  "ca",
  "zh-CN",
  "zh-TW",
  "hr",
  "cs",
  "da",
  "nl",
  "en",
  "en-AU",
  "en-CA",
  "en-GB",
  "et",
  "fi",
  "fr",
  "gl",
  "de",
  "el",
  "he",
  "hi",
  "hu",
  "is",
  "id",
  "ga",
  "it",
  "ja",
  "ko",
  "lv",
  "lt",
  "lb",
  "mk",
  "ms",
  "mt",
  "no",
  "pl",
  "pt",
  "pt-BR",
  "pt-PT",
  "ro",
  "ru",
  "sr",
  "sk",
  "sl",
  "es",
  "sv",
  "ta",
  "th",
  "tr",
  "uk",
  "vi",
  "cy"
];

const creditBase = {
  "en": {
    "documentTitle": "CREDIT NOTE",
    "orderNumber": "Credit Note#",
    "date": "Credit Note Date",
    "reference": "Invoice Ref#",
    "totalLabel": "Credit Total",
    "itemsInTotalLabel": "Items in Total",
    "refundedAmountLabel": "Credit Amount",
    "notes": "Credit issued against the referenced invoice.",
    "terms": "This credit note may be applied to future purchases or refunded as agreed."
  },
  "de": {
    "documentTitle": "GUTSCHRIFT",
    "orderNumber": "Gutschriftnr.",
    "date": "Gutschriftdatum",
    "reference": "Rechnungsref.-Nr.",
    "totalLabel": "Gutschrift gesamt",
    "itemsInTotalLabel": "Artikel gesamt",
    "refundedAmountLabel": "Gutschriftbetrag",
    "notes": "Gutschrift zu der referenzierten Rechnung.",
    "terms": "Diese Gutschrift kann auf zukünftige Käufe angerechnet oder wie vereinbart erstattet werden."
  },
  "fr": {
    "documentTitle": "AVOIR",
    "orderNumber": "Avoir n°",
    "date": "Date d'avoir",
    "reference": "Réf. facture n°",
    "totalLabel": "Total avoir",
    "itemsInTotalLabel": "Articles au total",
    "refundedAmountLabel": "Montant de l'avoir",
    "notes": "Avoir émis pour la facture référencée.",
    "terms": "Cet avoir peut être imputé sur de futurs achats ou remboursé selon accord."
  },
  "es": {
    "documentTitle": "NOTA DE CRÉDITO",
    "orderNumber": "Nota de crédito n°",
    "date": "Fecha de nota de crédito",
    "reference": "Ref. factura n°",
    "totalLabel": "Total crédito",
    "itemsInTotalLabel": "Artículos en total",
    "refundedAmountLabel": "Importe del crédito",
    "notes": "Crédito emitido contra la factura de referencia.",
    "terms": "Esta nota de crédito puede aplicarse a compras futuras o reembolsarse según lo acordado."
  },
  "it": {
    "documentTitle": "NOTA DI CREDITO",
    "orderNumber": "Nota di credito n°",
    "date": "Data nota di credito",
    "reference": "Rif. fattura n°",
    "totalLabel": "Totale nota di credito",
    "itemsInTotalLabel": "Articoli in totale",
    "refundedAmountLabel": "Importo del credito",
    "notes": "Nota di credito emessa per la fattura di riferimento.",
    "terms": "Questa nota di credito può essere applicata ad acquisti futuri o rimborsata come concordato."
  },
  "pt": {
    "documentTitle": "NOTA DE CRÉDITO",
    "orderNumber": "Nota de crédito n°",
    "date": "Data da nota de crédito",
    "reference": "Ref. fatura n°",
    "totalLabel": "Total do crédito",
    "itemsInTotalLabel": "Itens no total",
    "refundedAmountLabel": "Valor do crédito",
    "notes": "Crédito emitido referente à fatura indicada.",
    "terms": "Esta nota de crédito pode ser aplicada em compras futuras ou reembolsada conforme acordado."
  },
  "nl": {
    "documentTitle": "CREDITNOTA",
    "orderNumber": "Creditnota nr.",
    "date": "Creditnotadatum",
    "reference": "Factuurref. nr.",
    "totalLabel": "Credit totaal",
    "itemsInTotalLabel": "Artikelen totaal",
    "refundedAmountLabel": "Creditbedrag",
    "notes": "Creditnota uitgegeven voor de referentiefactuur.",
    "terms": "Deze creditnota kan worden verrekend met toekomstige aankopen of terugbetaald zoals overeengekomen."
  },
  "pl": {
    "documentTitle": "NOTA KORYGUJĄCA",
    "orderNumber": "Nota korygująca nr",
    "date": "Data noty korygującej",
    "reference": "Ref. faktury nr",
    "totalLabel": "Suma kredytu",
    "itemsInTotalLabel": "Pozycji łącznie",
    "refundedAmountLabel": "Kwota kredytu",
    "notes": "Uznanie wystawione w odniesieniu do wskazanej faktury.",
    "terms": "Niniejsze uznanie można zastosować do przyszłych zakupów lub zwrócić zgodnie z ustaleniami."
  },
  "sv": {
    "documentTitle": "KREDITNOTA",
    "orderNumber": "Kreditnota nr",
    "date": "Kreditnotadatum",
    "reference": "Fakturaref. nr",
    "totalLabel": "Kredittotal",
    "itemsInTotalLabel": "Artiklar totalt",
    "refundedAmountLabel": "Kreditbelopp",
    "notes": "Kredit utfärdad mot referensfakturan.",
    "terms": "Denna kreditnota kan tillämpas på framtida köp eller återbetalas enligt överenskommelse."
  },
  "da": {
    "documentTitle": "KREDITNOTA",
    "orderNumber": "Kreditnota nr.",
    "date": "Kreditnotadato",
    "reference": "Fakturaref. nr.",
    "totalLabel": "Kredit total",
    "itemsInTotalLabel": "Varer i alt",
    "refundedAmountLabel": "Kreditbeløb",
    "notes": "Kreditnota udstedt mod den refererede faktura.",
    "terms": "Denne kreditnota kan anvendes på fremtidige køb eller refunderes som aftalt."
  },
  "fi": {
    "documentTitle": "HYVITYSLASKU",
    "orderNumber": "Hyvityslasku nro",
    "date": "Hyvityslaskun päiväys",
    "reference": "Laskuviite nro",
    "totalLabel": "Hyvityksen yhteensä",
    "itemsInTotalLabel": "Tuotteita yhteensä",
    "refundedAmountLabel": "Hyvityssumma",
    "notes": "Hyvitys myönnetty viitattua laskua vastaan.",
    "terms": "Tätä hyvityslaskua voidaan käyttää tuleviin ostoihin tai palauttaa sovitusti."
  },
  "no": {
    "documentTitle": "KREDITNOTA",
    "orderNumber": "Kreditnota nr.",
    "date": "Kreditnotadato",
    "reference": "Fakturaref. nr.",
    "totalLabel": "Kredit totalt",
    "itemsInTotalLabel": "Varer totalt",
    "refundedAmountLabel": "Kreditbeløp",
    "notes": "Kreditnota utstedt mot referansefakturaen.",
    "terms": "Denne kreditnotaen kan brukes på fremtidige kjøp eller refunderes som avtalt."
  },
  "cs": {
    "documentTitle": "DOBROPIS",
    "orderNumber": "Dobropis č.",
    "date": "Datum dobropisu",
    "reference": "Ref. faktury č.",
    "totalLabel": "Dobropis celkem",
    "itemsInTotalLabel": "Položek celkem",
    "refundedAmountLabel": "Částka dobropisu",
    "notes": "Dobropis vystavený k referenční faktuře.",
    "terms": "Tento dobropis lze uplatnit na budoucí nákupy nebo vrátit dle dohody."
  },
  "hu": {
    "documentTitle": "JÓVÁÍRÓ SZÁMLA",
    "orderNumber": "Jóváíró számla#",
    "date": "Jóváíró számla dátuma",
    "reference": "Számlaref.#",
    "totalLabel": "Jóváírás összesen",
    "itemsInTotalLabel": "Tételek összesen",
    "refundedAmountLabel": "Jóváírás összege",
    "notes": "Jóváírás a hivatkozott számlára kiállítva.",
    "terms": "Ez a jóváíró számla jövőbeli vásárlásokra fordítható vagy visszatérítésre kerülhet megállapodás szerint."
  },
  "ro": {
    "documentTitle": "NOTĂ DE CREDIT",
    "orderNumber": "Notă de credit nr.",
    "date": "Data notei de credit",
    "reference": "Ref. factură nr.",
    "totalLabel": "Total credit",
    "itemsInTotalLabel": "Articole în total",
    "refundedAmountLabel": "Sumă credit",
    "notes": "Notă de credit emisă pentru factura de referință.",
    "terms": "Această notă de credit poate fi aplicată la achiziții viitoare sau rambursată conform acordului."
  },
  "el": {
    "documentTitle": "ΠΙΣΤΩΤΙΚΟ ΣΗΜΕΙΩΜΑ",
    "orderNumber": "Πιστωτικό σημείωμα#",
    "date": "Ημερομηνία πιστωτικού",
    "reference": "Αναφ. τιμολογίου#",
    "totalLabel": "Σύνολο πίστωσης",
    "itemsInTotalLabel": "Είδη συνολικά",
    "refundedAmountLabel": "Ποσό πίστωσης",
    "notes": "Πιστωτικό σημείωμα που εκδόθηκε για το αναφερόμενο τιμολόγιο.",
    "terms": "Το παρόν πιστωτικό σημείωμα μπορεί να εφαρμοστεί σε μελλοντικές αγορές ή να επιστραφεί όπως συμφωνήθηκε."
  },
  "tr": {
    "documentTitle": "ALACAK DEKONTU",
    "orderNumber": "Alacak dekontu#",
    "date": "Alacak dekontu tarihi",
    "reference": "Fatura ref.#",
    "totalLabel": "Alacak toplamı",
    "itemsInTotalLabel": "Toplam kalem",
    "refundedAmountLabel": "Alacak tutarı",
    "notes": "Referans faturaya karşı düzenlenen alacak dekontu.",
    "terms": "Bu alacak dekontu gelecekteki alışverişlerde kullanılabilir veya kararlaştırıldığı şekilde iade edilebilir."
  },
  "ru": {
    "documentTitle": "КРЕДИТ-НОТА",
    "orderNumber": "Кредит-нота №",
    "date": "Дата кредит-ноты",
    "reference": "Ссылка на счёт №",
    "totalLabel": "Итого по кредиту",
    "itemsInTotalLabel": "Позиций всего",
    "refundedAmountLabel": "Сумма кредита",
    "notes": "Кредит-нота, выданная по указанному счёту.",
    "terms": "Данная кредит-нота может быть зачтена при будущих покупках или возвращена по договорённости."
  },
  "uk": {
    "documentTitle": "КРЕДИТОВА НОТА",
    "orderNumber": "Кредитова нота №",
    "date": "Дата кредитової ноти",
    "reference": "Посилання на рахунок №",
    "totalLabel": "Разом кредит",
    "itemsInTotalLabel": "Позицій усього",
    "refundedAmountLabel": "Сума кредиту",
    "notes": "Кредитова нота, видана щодо зазначеного рахунку.",
    "terms": "Цю кредитову ноту можна застосувати до майбутніх покупок або повернути за домовленістю."
  },
  "ar": {
    "documentTitle": "إشعار دائن",
    "orderNumber": "إشعار دائن#",
    "date": "تاريخ إشعار الدائن",
    "reference": "مرجع الفاتورة#",
    "totalLabel": "إجمالي الدائن",
    "itemsInTotalLabel": "إجمالي الأصناف",
    "refundedAmountLabel": "مبلغ الدائن",
    "notes": "تم إصدار إشعار دائن مقابل الفاتورة المرجعية.",
    "terms": "يمكن تطبيق إشعار الدائن هذا على مشتريات مستقبلية أو استرداده وفق الاتفاق."
  },
  "he": {
    "documentTitle": "זיכוי",
    "orderNumber": "זיכוי#",
    "date": "תאריך זיכוי",
    "reference": "אסמכתא לחשבונית#",
    "totalLabel": "סה\"כ זיכוי",
    "itemsInTotalLabel": "פריטים בסך הכל",
    "refundedAmountLabel": "סכום זיכוי",
    "notes": "זיכוי הוצא כנגד חשבונית הייחוס.",
    "terms": "ניתן לקזז זיכוי זה ברכישות עתידיות או להחזירו בהתאם להסכמה."
  },
  "hi": {
    "documentTitle": "क्रेडिट नोट",
    "orderNumber": "क्रेडिट नोट#",
    "date": "क्रेडिट नोट की तिथि",
    "reference": "चालान संदर्भ#",
    "totalLabel": "क्रेडिट कुल",
    "itemsInTotalLabel": "कुल वस्तुएँ",
    "refundedAmountLabel": "क्रेडिट राशि",
    "notes": "संदर्भित चालान के विरुद्ध जारी किया गया क्रेडिट नोट।",
    "terms": "यह क्रेडिट नोट भविष्य की खरीद पर लागू किया जा सकता है या सहमति के अनुसार वापस किया जा सकता है।"
  },
  "ta": {
    "documentTitle": "கடன் குறிப்பு",
    "orderNumber": "கடன் குறிப்பு#",
    "date": "கடன் குறிப்பு தேதி",
    "reference": "விலைப்பட்டியல் ref.#",
    "totalLabel": "கடன் மொத்தம்",
    "itemsInTotalLabel": "மொத்த பொருட்கள்",
    "refundedAmountLabel": "கடன் தொகை",
    "notes": "குறிப்பிட்ட விலைப்பட்டியலுக்கு எதிராக வெளியிடப்பட்ட கடன் குறிப்பு.",
    "terms": "இந்த கடன் குறிப்பை எதிர்கால கொள்முதல்களில் பயன்படுத்தலாம் அல்லது ஒப்புக்கொண்டபடி திருப்பிச் செலுத்தலாம்."
  },
  "th": {
    "documentTitle": "ใบลดหนี้",
    "orderNumber": "ใบลดหนี้#",
    "date": "วันที่ใบลดหนี้",
    "reference": "อ้างอิงใบแจ้งหนี้#",
    "totalLabel": "ยอดเครดิตรวม",
    "itemsInTotalLabel": "รายการทั้งหมด",
    "refundedAmountLabel": "จำนวนเครดิต",
    "notes": "ออกใบลดหนี้สำหรับใบแจ้งหนี้อ้างอิง",
    "terms": "ใบลดหนี้นี้อาจใช้กับการซื้อในอนาคตหรือคืนเงินตามที่ตกลง"
  },
  "vi": {
    "documentTitle": "GIẤY BÁO CÓ",
    "orderNumber": "Giấy báo có#",
    "date": "Ngày giấy báo có",
    "reference": "Tham chiếu hóa đơn#",
    "totalLabel": "Tổng có",
    "itemsInTotalLabel": "Tổng số mặt hàng",
    "refundedAmountLabel": "Số tiền có",
    "notes": "Giấy báo có được lập đối với hóa đơn tham chiếu.",
    "terms": "Giấy báo có này có thể áp dụng cho các giao dịch mua sau hoặc được hoàn trả theo thỏa thuận."
  },
  "id": {
    "documentTitle": "NOTA KREDIT",
    "orderNumber": "Nota kredit#",
    "date": "Tanggal nota kredit",
    "reference": "Ref. faktur#",
    "totalLabel": "Total kredit",
    "itemsInTotalLabel": "Total item",
    "refundedAmountLabel": "Jumlah kredit",
    "notes": "Nota kredit diterbitkan untuk faktur referensi.",
    "terms": "Nota kredit ini dapat diterapkan pada pembelian mendatang atau dikembalikan sesuai kesepakatan."
  },
  "ms": {
    "documentTitle": "NOTA KREDIT",
    "orderNumber": "Nota kredit#",
    "date": "Tarikh nota kredit",
    "reference": "Ruj. invois#",
    "totalLabel": "Jumlah kredit",
    "itemsInTotalLabel": "Jumlah item",
    "refundedAmountLabel": "Amaun kredit",
    "notes": "Nota kredit dikeluarkan berbanding invois rujukan.",
    "terms": "Nota kredit ini boleh digunakan untuk pembelian akan datang atau dibayar balik seperti dipersetujui."
  },
  "ja": {
    "documentTitle": "クレジットノート",
    "orderNumber": "クレジットノート#",
    "date": "クレジットノート日付",
    "reference": "請求書参照#",
    "totalLabel": "クレジット合計",
    "itemsInTotalLabel": "明細合計",
    "refundedAmountLabel": "クレジット金額",
    "notes": "参照請求書に対して発行されたクレジットノートです。",
    "terms": "本クレジットノートは今後のご購入に充当するか、合意に基づき返金することができます。"
  },
  "ko": {
    "documentTitle": "크레딧 노트",
    "orderNumber": "크레딧 노트#",
    "date": "크레딧 노트 일자",
    "reference": "청구서 참조#",
    "totalLabel": "크레딧 합계",
    "itemsInTotalLabel": "품목 합계",
    "refundedAmountLabel": "크레딧 금액",
    "notes": "참조 청구서에 대해 발행된 크레딧 노트입니다.",
    "terms": "본 크레딧 노트는 향후 구매에 적용하거나 합의에 따라 환불할 수 있습니다."
  },
  "zh-CN": {
    "documentTitle": "贷项通知单",
    "orderNumber": "贷项通知单#",
    "date": "贷项通知单日期",
    "reference": "发票参考#",
    "totalLabel": "贷项合计",
    "itemsInTotalLabel": "明细合计",
    "refundedAmountLabel": "贷项金额",
    "notes": "针对参考发票开具的贷项通知单。",
    "terms": "本贷项通知单可用于今后采购抵扣或按约定退款。"
  },
  "zh-TW": {
    "documentTitle": "折讓單",
    "orderNumber": "折讓單#",
    "date": "折讓單日期",
    "reference": "發票參考#",
    "totalLabel": "折讓合計",
    "itemsInTotalLabel": "品項合計",
    "refundedAmountLabel": "折讓金額",
    "notes": "針對參考發票開立的折讓單。",
    "terms": "本折讓單可於日後採購抵扣或依約退款。"
  },
  "bg": {
    "documentTitle": "КРЕДИТНО ИЗВЕСТИЕ",
    "orderNumber": "Кредитно известие №",
    "date": "Дата на кредитното известие",
    "reference": "Реф. фактура №",
    "totalLabel": "Общо кредит",
    "itemsInTotalLabel": "Артикули общо",
    "refundedAmountLabel": "Сума кредит",
    "notes": "Кредитно известие, издадено спрямо референтната фактура.",
    "terms": "Това кредитно известие може да бъде приложено към бъдещи покупки или възстановено по договореност."
  },
  "hr": {
    "documentTitle": "KREDITNA NOTA",
    "orderNumber": "Kreditna nota#",
    "date": "Datum kreditne note",
    "reference": "Ref. računa#",
    "totalLabel": "Ukupno kredit",
    "itemsInTotalLabel": "Stavki ukupno",
    "refundedAmountLabel": "Iznos kredita",
    "notes": "Kreditna nota izdana za referentni račun.",
    "terms": "Ova kreditna nota može se primijeniti na buduće kupnje ili vratiti prema dogovoru."
  },
  "sk": {
    "documentTitle": "DOBROPIS",
    "orderNumber": "Dobropis č.",
    "date": "Dátum dobropisu",
    "reference": "Ref. faktúry č.",
    "totalLabel": "Dobropis spolu",
    "itemsInTotalLabel": "Položiek spolu",
    "refundedAmountLabel": "Suma dobropisu",
    "notes": "Dobropis vystavený k referenčnej faktúre.",
    "terms": "Tento dobropis možno uplatniť na budúce nákupy alebo vrátiť podľa dohody."
  },
  "sl": {
    "documentTitle": "DOBROPIS",
    "orderNumber": "Dobropis#",
    "date": "Datum dobropisa",
    "reference": "Ref. računa#",
    "totalLabel": "Skupaj dobropis",
    "itemsInTotalLabel": "Postavk skupaj",
    "refundedAmountLabel": "Znesek dobropisa",
    "notes": "Dobropis, izdan za referenčni račun.",
    "terms": "Ta dobropis se lahko uporabi pri prihodnjih nakupih ali povrne po dogovoru."
  },
  "sr": {
    "documentTitle": "KREDITNA NOTA",
    "orderNumber": "Kreditna nota#",
    "date": "Datum kreditne note",
    "reference": "Ref. fakture#",
    "totalLabel": "Ukupno kredit",
    "itemsInTotalLabel": "Stavki ukupno",
    "refundedAmountLabel": "Iznos kredita",
    "notes": "Kreditna nota izdata za referentnu fakturu.",
    "terms": "Ova kreditna nota može se primeniti na buduće kupovine ili refundirati prema dogovoru."
  },
  "et": {
    "documentTitle": "KREEDITARVE",
    "orderNumber": "Kreeditarve nr",
    "date": "Kreeditarve kuupäev",
    "reference": "Arve viide nr",
    "totalLabel": "Krediit kokku",
    "itemsInTotalLabel": "Kaupu kokku",
    "refundedAmountLabel": "Krediidisumma",
    "notes": "Kreeditarve väljastatud viidatud arve alusel.",
    "terms": "Seda kreeditarvet saab kasutada tulevaste ostude jaoks või tagastada kokkulepitud viisil."
  },
  "lv": {
    "documentTitle": "KREDĪTNOTA",
    "orderNumber": "Kredītnota nr.",
    "date": "Kredītnotas datums",
    "reference": "Rēķina atsauce nr.",
    "totalLabel": "Kredīts kopā",
    "itemsInTotalLabel": "Preces kopā",
    "refundedAmountLabel": "Kredīta summa",
    "notes": "Kredītnota izsniegta attiecībā pret norādīto rēķinu.",
    "terms": "Šo kredītnotu var piemērot turpmākiem pirkumiem vai atmaksāt pēc vienošanās."
  },
  "lt": {
    "documentTitle": "KREDITINĖ SĄSKAITA",
    "orderNumber": "Kreditinė sąskaita nr.",
    "date": "Kreditinės sąskaitos data",
    "reference": "Sąskaitos nuoroda nr.",
    "totalLabel": "Kreditas iš viso",
    "itemsInTotalLabel": "Prekių iš viso",
    "refundedAmountLabel": "Kredito suma",
    "notes": "Kreditinė sąskaita išrašyta pagal nurodytą sąskaitą.",
    "terms": "Šią kreditinę sąskaitą galima pritaikyti būsimiems pirkimams arba grąžinti pagal susitarimą."
  },
  "ca": {
    "documentTitle": "NOTA DE CRÈDIT",
    "orderNumber": "Nota de crèdit núm.",
    "date": "Data de la nota de crèdit",
    "reference": "Ref. factura núm.",
    "totalLabel": "Total crèdit",
    "itemsInTotalLabel": "Articles en total",
    "refundedAmountLabel": "Import del crèdit",
    "notes": "Crèdit emès contra la factura de referència.",
    "terms": "Aquesta nota de crèdit es pot aplicar a compres futures o reemborsar-se segons l'acord."
  },
  "gl": {
    "documentTitle": "NOTA DE ABONO",
    "orderNumber": "Nota de abono nº",
    "date": "Data da nota de abono",
    "reference": "Ref. factura nº",
    "totalLabel": "Total abono",
    "itemsInTotalLabel": "Artigos en total",
    "refundedAmountLabel": "Importe do abono",
    "notes": "Abono emitido fronte á factura de referencia.",
    "terms": "Esta nota de abono pode aplicarse a compras futuras ou reembolsarse segundo o acordado."
  },
  "eu": {
    "documentTitle": "KREDITO OHARRA",
    "orderNumber": "Kredito oharra#",
    "date": "Kredito ohar data",
    "reference": "Faktura erref.#",
    "totalLabel": "Kreditu guztira",
    "itemsInTotalLabel": "Artikuluak guztira",
    "refundedAmountLabel": "Kreditu zenbatekoa",
    "notes": "Erreferentziako fakturaren aurka jaulkitako kredito oharra.",
    "terms": "Kredito ohar hau etorkizuneko erosketetan aplikatu edo adostutakoaren arabera itzuli daiteke."
  },
  "sq": {
    "documentTitle": "NOTË KREDI",
    "orderNumber": "Notë krediti#",
    "date": "Data e notës së kreditit",
    "reference": "Ref. faturë#",
    "totalLabel": "Totali i kreditit",
    "itemsInTotalLabel": "Artikuj gjithsej",
    "refundedAmountLabel": "Shuma e kreditit",
    "notes": "Krediti lëshuar kundër faturës së referencës.",
    "terms": "Kjo notë krediti mund të aplikohet në blerje të ardhshme ose të rimbursohet sipas marrëveshjes."
  },
  "be": {
    "documentTitle": "КРЭДЫТАВАЯ НОТА",
    "orderNumber": "Крэдытавая нота №",
    "date": "Дата крэдытавай ноты",
    "reference": "Спасл. на рахунок №",
    "totalLabel": "Усяго крэдыт",
    "itemsInTotalLabel": "Пазіцый усяго",
    "refundedAmountLabel": "Сума крэдыту",
    "notes": "Крэдытавая нота, выдадзеная да пазначанага рахунку.",
    "terms": "Гэту крэдытавую ноту можна прымяніць да будучых пакупак або вярнуць па дамоўленасці."
  },
  "bs": {
    "documentTitle": "KREDITNA NOTA",
    "orderNumber": "Kreditna nota#",
    "date": "Datum kreditne note",
    "reference": "Ref. fakture#",
    "totalLabel": "Ukupno kredit",
    "itemsInTotalLabel": "Stavki ukupno",
    "refundedAmountLabel": "Iznos kredita",
    "notes": "Kreditna nota izdata za referentnu fakturu.",
    "terms": "Ova kreditna nota se može primijeniti na buduće kupovine ili refundirati prema dogovoru."
  },
  "mk": {
    "documentTitle": "КРЕДИТНА НОТА",
    "orderNumber": "Кредитна нота#",
    "date": "Датум на кредитна нота",
    "reference": "Реф. фактура#",
    "totalLabel": "Вкупно кредит",
    "itemsInTotalLabel": "Ставки вкупно",
    "refundedAmountLabel": "Износ на кредит",
    "notes": "Кредитна нота издадена за референтната фактура.",
    "terms": "Оваа кредитна нота може да се примени на идни купувања или да се рефундира според договор."
  },
  "is": {
    "documentTitle": "KREDDÍTREIKNINGUR",
    "orderNumber": "Kreddíreikningur#",
    "date": "Dagsetning kreddíreiknings",
    "reference": "Tilv. reiknings#",
    "totalLabel": "Kredit samtals",
    "itemsInTotalLabel": "Vörur samtals",
    "refundedAmountLabel": "Kreditupphæð",
    "notes": "Kreddíreikningur gefinn út vegna tilvísunarreiknings.",
    "terms": "Þessi kreddíreikningur má beita við framtíðarkaup eða endurgreiða samkvæmt samkomulagi."
  },
  "ga": {
    "documentTitle": "NOTA CREIDMHEASA",
    "orderNumber": "Nota creidmheasa#",
    "date": "Dáta na nota creidmheasa",
    "reference": "Tag. sonrasc#",
    "totalLabel": "Iomlán creidmheasa",
    "itemsInTotalLabel": "Míreanna iomlán",
    "refundedAmountLabel": "Méid creidmheasa",
    "notes": "Creidmheas eisithe i gcoinne an sonraisc tagartha.",
    "terms": "Is féidir an nóta creidmheasa seo a chur i bhfeidhm ar cheannacháin amach anseo nó aisíoc de réir comhaontaithe."
  },
  "cy": {
    "documentTitle": "NODYN CREDYD",
    "orderNumber": "Nodyn credyd#",
    "date": "Dyddiad y nodyn credyd",
    "reference": "Cyf. anfoneb#",
    "totalLabel": "Cyfanswm credyd",
    "itemsInTotalLabel": "Eitemau i gyd",
    "refundedAmountLabel": "Swm credyd",
    "notes": "Credyd a roddwyd yn erbyn yr anfoneb cyfeirnod.",
    "terms": "Gellir defnyddio'r nodyn credyd hwn ar bryniannau yn y dyfodol neu ei ad-dalu fel y cytunwyd."
  },
  "mt": {
    "documentTitle": "NOTA TA' KREDITU",
    "orderNumber": "Nota ta' kreditu#",
    "date": "Data tan-nota ta' kreditu",
    "reference": "Ref. fattura#",
    "totalLabel": "Total kreditu",
    "itemsInTotalLabel": "Oġġetti totali",
    "refundedAmountLabel": "Ammont ta' kreditu",
    "notes": "Kreditu maħruġ kontra l-fattura ta' referenza.",
    "terms": "Din in-nota ta' kreditu tista' tiġi applikata għal xiri futur jew rimborżata skont il-ftehim."
  },
  "lb": {
    "documentTitle": "GUTSCHRIFT",
    "orderNumber": "Gutschriftnr.",
    "date": "Gutschriftdatum",
    "reference": "Rechnungsref.-Nr.",
    "totalLabel": "Gutschrift gesamt",
    "itemsInTotalLabel": "Artikelen gesamt",
    "refundedAmountLabel": "Gutschriftbetrag",
    "notes": "Gutschrift fir déi referenzéiert Rechnung.",
    "terms": "Dës Gutschrift kann op zukünfteg Akeef ugerechent oder no Ofkommes rembourséiert ginn."
  }
};

const packingBase = {
  "en": {
    "documentTitle": "PACKING SLIP",
    "orderNumber": "Packing Slip#",
    "date": "Packing Date",
    "reference": "Order Ref#",
    "totalLabel": "Packed Total",
    "itemsInTotalLabel": "Items packed",
    "notes": "Please check contents against this packing slip.",
    "terms": "Report missing or damaged items within 48 hours of delivery."
  },
  "de": {
    "documentTitle": "LIEFERSCHEIN",
    "orderNumber": "Lieferscheinnr.",
    "date": "Packdatum",
    "reference": "Bestellref.-Nr.",
    "totalLabel": "Packgesamt",
    "itemsInTotalLabel": "Gepackte Artikel",
    "notes": "Bitte prüfen Sie den Inhalt anhand dieses Lieferscheins.",
    "terms": "Fehlende oder beschädigte Artikel innerhalb von 48 Stunden nach Lieferung melden."
  },
  "fr": {
    "documentTitle": "BON DE LIVRAISON",
    "orderNumber": "Bon de livraison n°",
    "date": "Date d'emballage",
    "reference": "Réf. commande n°",
    "totalLabel": "Total emballé",
    "itemsInTotalLabel": "Articles emballés",
    "notes": "Veuillez vérifier le contenu à l'aide de ce bon de livraison.",
    "terms": "Signalez les articles manquants ou endommagés dans les 48 heures suivant la livraison."
  },
  "es": {
    "documentTitle": "ALBARÁN",
    "orderNumber": "Albarán n°",
    "date": "Fecha de embalaje",
    "reference": "Ref. pedido n°",
    "totalLabel": "Total embalado",
    "itemsInTotalLabel": "Artículos embalados",
    "notes": "Compruebe el contenido con este albarán.",
    "terms": "Informe de artículos faltantes o dañados en un plazo de 48 horas tras la entrega."
  },
  "it": {
    "documentTitle": "DOCUMENTO DI TRASPORTO",
    "orderNumber": "DDT n°",
    "date": "Data di imballaggio",
    "reference": "Rif. ordine n°",
    "totalLabel": "Totale imballato",
    "itemsInTotalLabel": "Articoli imballati",
    "notes": "Verificare il contenuto rispetto a questo documento di trasporto.",
    "terms": "Segnalare articoli mancanti o danneggiati entro 48 ore dalla consegna."
  },
  "pt": {
    "documentTitle": "GUIA DE REMESSA",
    "orderNumber": "Guia de remessa n°",
    "date": "Data de embalagem",
    "reference": "Ref. encomenda n°",
    "totalLabel": "Total embalado",
    "itemsInTotalLabel": "Itens embalados",
    "notes": "Verifique o conteúdo com esta guia de remessa.",
    "terms": "Comunique artigos em falta ou danificados no prazo de 48 horas após a entrega."
  },
  "nl": {
    "documentTitle": "PAKBON",
    "orderNumber": "Pakbon nr.",
    "date": "Pakdatum",
    "reference": "Orderref. nr.",
    "totalLabel": "Totaal verpakt",
    "itemsInTotalLabel": "Verpakte artikelen",
    "notes": "Controleer de inhoud aan de hand van deze pakbon.",
    "terms": "Meld ontbrekende of beschadigde artikelen binnen 48 uur na levering."
  },
  "pl": {
    "documentTitle": "LIST PRZEWOZOWY",
    "orderNumber": "List przewozowy nr",
    "date": "Data pakowania",
    "reference": "Ref. zamówienia nr",
    "totalLabel": "Suma spakowana",
    "itemsInTotalLabel": "Spakowane pozycje",
    "notes": "Sprawdź zawartość na podstawie tego listu przewozowego.",
    "terms": "Zgłoś brakujące lub uszkodzone pozycje w ciągu 48 godzin od dostawy."
  },
  "sv": {
    "documentTitle": "FÖLJESEDEL",
    "orderNumber": "Följesedel nr",
    "date": "Packdatum",
    "reference": "Orderref. nr",
    "totalLabel": "Packat totalt",
    "itemsInTotalLabel": "Packade artiklar",
    "notes": "Kontrollera innehållet mot denna följesedel.",
    "terms": "Rapportera saknade eller skadade artiklar inom 48 timmar efter leverans."
  },
  "da": {
    "documentTitle": "FØLGESEDDEL",
    "orderNumber": "Følgeseddel nr.",
    "date": "Pakningsdato",
    "reference": "Ordref. nr.",
    "totalLabel": "Pakket i alt",
    "itemsInTotalLabel": "Pakkede varer",
    "notes": "Kontrollér indholdet i forhold til denne følgeseddel.",
    "terms": "Anmeld manglende eller beskadigede varer inden for 48 timer efter levering."
  },
  "fi": {
    "documentTitle": "TOIMITUSLISTA",
    "orderNumber": "Toimituslista nro",
    "date": "Pakkauspäivä",
    "reference": "Tilausviite nro",
    "totalLabel": "Pakattu yhteensä",
    "itemsInTotalLabel": "Pakattuja tuotteita",
    "notes": "Tarkista sisältö tätä toimituslistaa vasten.",
    "terms": "Ilmoita puuttuvista tai vaurioituneista tuotteista 48 tunnin kuluessa toimituksesta."
  },
  "no": {
    "documentTitle": "FØLGESEDDEL",
    "orderNumber": "Følgeseddel nr.",
    "date": "Pakningsdato",
    "reference": "Ordre ref. nr.",
    "totalLabel": "Pakket totalt",
    "itemsInTotalLabel": "Pakkede varer",
    "notes": "Kontroller innholdet mot denne følgeseddelen.",
    "terms": "Rapporter manglende eller skadede varer innen 48 timer etter levering."
  },
  "cs": {
    "documentTitle": "DODACÍ LIST",
    "orderNumber": "Dodací list č.",
    "date": "Datum balení",
    "reference": "Ref. objednávky č.",
    "totalLabel": "Celkem zabaleno",
    "itemsInTotalLabel": "Zabalené položky",
    "notes": "Zkontrolujte obsah podle tohoto dodacího listu.",
    "terms": "Nahlaste chybějící nebo poškozené položky do 48 hodin od doručení."
  },
  "hu": {
    "documentTitle": "SZÁLLÍTÓLEVÉL",
    "orderNumber": "Szállítólevél#",
    "date": "Csomagolás dátuma",
    "reference": "Rendelés ref.#",
    "totalLabel": "Csomagolt összesen",
    "itemsInTotalLabel": "Csomagolt tételek",
    "notes": "Ellenőrizze a tartalmat a szállítólevél alapján.",
    "terms": "Jelentse a hiányzó vagy sérült tételeket a kézbesítéstől számított 48 órán belül."
  },
  "ro": {
    "documentTitle": "AVIZ DE EXPEDIȚIE",
    "orderNumber": "Aviz de expediție nr.",
    "date": "Data ambalării",
    "reference": "Ref. comandă nr.",
    "totalLabel": "Total ambalat",
    "itemsInTotalLabel": "Articole ambalate",
    "notes": "Verificați conținutul conform acestui aviz de expediție.",
    "terms": "Raportați articolele lipsă sau deteriorate în termen de 48 de ore de la livrare."
  },
  "el": {
    "documentTitle": "ΔΕΛΤΙΟ ΑΠΟΣΤΟΛΗΣ",
    "orderNumber": "Δελτίο αποστολής#",
    "date": "Ημερομηνία συσκευασίας",
    "reference": "Αναφ. παραγγελίας#",
    "totalLabel": "Σύνολο συσκευασμένων",
    "itemsInTotalLabel": "Συσκευασμένα είδη",
    "notes": "Ελέγξτε το περιεχόμενο με βάση αυτό το δελτίο αποστολής.",
    "terms": "Αναφέρετε ελλείποντα ή κατεστραμμένα είδη εντός 48 ωρών από την παράδοση."
  },
  "tr": {
    "documentTitle": "SEVK İRSALİYESİ",
    "orderNumber": "Sevk irsaliyesi#",
    "date": "Paketleme tarihi",
    "reference": "Sipariş ref.#",
    "totalLabel": "Paketlenen toplam",
    "itemsInTotalLabel": "Paketlenen kalemler",
    "notes": "Lütfen içeriği bu sevk irsaliyesine göre kontrol edin.",
    "terms": "Eksik veya hasarlı ürünleri teslimattan sonraki 48 saat içinde bildirin."
  },
  "ru": {
    "documentTitle": "УПАКОВОЧНЫЙ ЛИСТ",
    "orderNumber": "Упаковочный лист №",
    "date": "Дата упаковки",
    "reference": "Ссылка на заказ №",
    "totalLabel": "Итого упаковано",
    "itemsInTotalLabel": "Упакованных позиций",
    "notes": "Проверьте содержимое по данному упаковочному листу.",
    "terms": "Сообщите о недостающих или повреждённых позициях в течение 48 часов после доставки."
  },
  "uk": {
    "documentTitle": "ПАКУВАЛЬНИЙ ЛИСТ",
    "orderNumber": "Пакувальний лист №",
    "date": "Дата пакування",
    "reference": "Посилання на замовлення №",
    "totalLabel": "Упаковано всього",
    "itemsInTotalLabel": "Упакованих позицій",
    "notes": "Перевірте вміст за цим пакувальним листом.",
    "terms": "Повідомте про відсутні або пошкоджені позиції протягом 48 годин після доставки."
  },
  "ar": {
    "documentTitle": "قائمة التعبئة",
    "orderNumber": "قائمة التعبئة#",
    "date": "تاريخ التعبئة",
    "reference": "مرجع الطلب#",
    "totalLabel": "إجمالي المعبأ",
    "itemsInTotalLabel": "الأصناف المعبأة",
    "notes": "يرجى التحقق من المحتويات وفق قائمة التعبئة هذه.",
    "terms": "أبلغ عن الأصناف المفقودة أو التالفة خلال 48 ساعة من التسليم."
  },
  "he": {
    "documentTitle": "תעודת אריזה",
    "orderNumber": "תעודת אריזה#",
    "date": "תאריך אריזה",
    "reference": "אסמכתא להזמנה#",
    "totalLabel": "סה\"כ ארוז",
    "itemsInTotalLabel": "פריטים ארוזים",
    "notes": "אנא בדקו את התוכן מול תעודת אריזה זו.",
    "terms": "דווחו על פריטים חסרים או פגומים בתוך 48 שעות מהמסירה."
  },
  "hi": {
    "documentTitle": "पैकिंग स्लिप",
    "orderNumber": "पैकिंग स्लिप#",
    "date": "पैकिंग की तिथि",
    "reference": "ऑर्डर संदर्भ#",
    "totalLabel": "पैक कुल",
    "itemsInTotalLabel": "पैक की गई वस्तुएँ",
    "notes": "कृपया इस पैकिंग स्लिप के अनुसार सामग्री की जाँच करें।",
    "terms": "डिलीवरी के 48 घंटे के भीतर गायब या क्षतिग्रस्त वस्तुओं की सूचना दें।"
  },
  "ta": {
    "documentTitle": "பேக்கிங் சீட்டு",
    "orderNumber": "பேக்கிங் சீட்டு#",
    "date": "பேக்கிங் தேதி",
    "reference": "ஆர்டர் ref.#",
    "totalLabel": "பேக் செய்த மொத்தம்",
    "itemsInTotalLabel": "பேக் செய்த பொருட்கள்",
    "notes": "இந்த பேக்கிங் சீட்டை அடிப்படையாகக் கொண்டு உள்ளடக்கத்தை சரிபார்க்கவும்.",
    "terms": "வழங்கலிலிருந்து 48 மணி நேரத்திற்குள் காணாமல் போன அல்லது சேதமடைந்த பொருட்களைப் புகாரளிக்கவும்."
  },
  "th": {
    "documentTitle": "ใบแพ็กสินค้า",
    "orderNumber": "ใบแพ็กสินค้า#",
    "date": "วันที่แพ็ก",
    "reference": "อ้างอิงคำสั่งซื้อ#",
    "totalLabel": "รวมที่แพ็ก",
    "itemsInTotalLabel": "รายการที่แพ็ก",
    "notes": "โปรดตรวจสอบรายการตามใบแพ็กสินค้านี้",
    "terms": "แจ้งสินค้าที่หายหรือเสียหายภายใน 48 ชั่วโมงหลังจัดส่ง"
  },
  "vi": {
    "documentTitle": "PHIẾU ĐÓNG GÓI",
    "orderNumber": "Phiếu đóng gói#",
    "date": "Ngày đóng gói",
    "reference": "Tham chiếu đơn hàng#",
    "totalLabel": "Tổng đã đóng gói",
    "itemsInTotalLabel": "Mặt hàng đã đóng gói",
    "notes": "Vui lòng kiểm tra nội dung theo phiếu đóng gói này.",
    "terms": "Báo cáo hàng thiếu hoặc hư hỏng trong vòng 48 giờ kể từ khi giao hàng."
  },
  "id": {
    "documentTitle": "DAFTAR PENGIRIMAN",
    "orderNumber": "Daftar pengiriman#",
    "date": "Tanggal pengepakan",
    "reference": "Ref. pesanan#",
    "totalLabel": "Total dikemas",
    "itemsInTotalLabel": "Item dikemas",
    "notes": "Periksa isi sesuai daftar pengiriman ini.",
    "terms": "Laporkan barang hilang atau rusak dalam 48 jam setelah pengiriman."
  },
  "ms": {
    "documentTitle": "SENARAI PELEKATAN",
    "orderNumber": "Senarai pelekatan#",
    "date": "Tarikh pelekatan",
    "reference": "Ruj. pesanan#",
    "totalLabel": "Jumlah dipelek",
    "itemsInTotalLabel": "Item dipelek",
    "notes": "Sila semak kandungan berbanding senarai pelekatan ini.",
    "terms": "Laporkan item hilang atau rosak dalam tempoh 48 jam selepas penghantaran."
  },
  "ja": {
    "documentTitle": "梱包明細書",
    "orderNumber": "梱包明細書#",
    "date": "梱包日",
    "reference": "注文参照#",
    "totalLabel": "梱包合計",
    "itemsInTotalLabel": "梱包品目",
    "notes": "本梱包明細書と内容をご確認ください。",
    "terms": "欠品または破損は配達後48時間以内にご連絡ください。"
  },
  "ko": {
    "documentTitle": "포장 명세서",
    "orderNumber": "포장 명세서#",
    "date": "포장 일자",
    "reference": "주문 참조#",
    "totalLabel": "포장 합계",
    "itemsInTotalLabel": "포장 품목",
    "notes": "본 포장 명세서와 내용을 확인해 주세요.",
    "terms": "누락 또는 파손 품목은 배송 후 48시간 이내에 알려 주세요."
  },
  "zh-CN": {
    "documentTitle": "装箱单",
    "orderNumber": "装箱单#",
    "date": "装箱日期",
    "reference": "订单参考#",
    "totalLabel": "装箱合计",
    "itemsInTotalLabel": "已装物品",
    "notes": "请根据本装箱单核对内容。",
    "terms": "请在送达后48小时内报告缺失或损坏的物品。"
  },
  "zh-TW": {
    "documentTitle": "裝箱單",
    "orderNumber": "裝箱單#",
    "date": "裝箱日期",
    "reference": "訂單參考#",
    "totalLabel": "裝箱合計",
    "itemsInTotalLabel": "已裝品項",
    "notes": "請依本裝箱單核對內容。",
    "terms": "請於送達後48小時內回報缺失或損壞品項。"
  },
  "bg": {
    "documentTitle": "ОПАКОВЪЧЕН ЛИСТ",
    "orderNumber": "Опаковъчен лист №",
    "date": "Дата на опаковане",
    "reference": "Реф. поръчка №",
    "totalLabel": "Опаковано общо",
    "itemsInTotalLabel": "Опаковани артикули",
    "notes": "Моля, проверете съдържанието спрямо този опаковъчен лист.",
    "terms": "Докладвайте липсващи или повредени артикули в рамките на 48 часа след доставката."
  },
  "hr": {
    "documentTitle": "OTPREMNICA",
    "orderNumber": "Otpremnica#",
    "date": "Datum pakiranja",
    "reference": "Ref. narudžbe#",
    "totalLabel": "Ukupno pakirano",
    "itemsInTotalLabel": "Pakirane stavke",
    "notes": "Provjerite sadržaj prema ovoj otpremnici.",
    "terms": "Prijavite nedostajuće ili oštećene stavke u roku od 48 sati od isporuke."
  },
  "sk": {
    "documentTitle": "BALÍKOVÝ LIST",
    "orderNumber": "Balíkový list č.",
    "date": "Dátum balenia",
    "reference": "Ref. objednávky č.",
    "totalLabel": "Spolu zabalené",
    "itemsInTotalLabel": "Zabalené položky",
    "notes": "Skontrolujte obsah podľa tohto balíkového listu.",
    "terms": "Nahláste chýbajúce alebo poškodené položky do 48 hodín od doručenia."
  },
  "sl": {
    "documentTitle": "DOBAVNICA",
    "orderNumber": "Dobavnica#",
    "date": "Datum pakiranja",
    "reference": "Ref. naročila#",
    "totalLabel": "Skupaj pakirano",
    "itemsInTotalLabel": "Pakirane postavke",
    "notes": "Preverite vsebino glede na to dobavnico.",
    "terms": "Prijavite manjkajoče ali poškodovane postavke v 48 urah po dostavi."
  },
  "sr": {
    "documentTitle": "OTPREMNICA",
    "orderNumber": "Otpremnica#",
    "date": "Datum pakovanja",
    "reference": "Ref. porudžbine#",
    "totalLabel": "Ukupno pakovano",
    "itemsInTotalLabel": "Pakovane stavke",
    "notes": "Proverite sadržaj prema ovoj otpremnici.",
    "terms": "Prijavite nedostajuće ili ošmećene stavke u roku od 48 sati od isporuke."
  },
  "et": {
    "documentTitle": "SAATELEHT",
    "orderNumber": "Saateleht nr",
    "date": "Pakendamise kuupäev",
    "reference": "Tellimuse viide nr",
    "totalLabel": "Pakitud kokku",
    "itemsInTotalLabel": "Pakitud kaubad",
    "notes": "Kontrollige sisu selle saatelehe alusel.",
    "terms": "Teatage puuduvatest või kahjustatud kaupadest 48 tunni jooksul pärast kohaletoimetamist."
  },
  "lv": {
    "documentTitle": "IEKĻAUŠANAS LAPA",
    "orderNumber": "Iekļaušanas lapa nr.",
    "date": "Iepakošanas datums",
    "reference": "Pasūtījuma atsauce nr.",
    "totalLabel": "Iepakots kopā",
    "itemsInTotalLabel": "Iepakotas preces",
    "notes": "Lūdzu, pārbaudiet saturu pēc šīs iekļaušanas lapas.",
    "terms": "Ziņojiet par trūkstošām vai bojātām precēm 48 stundu laikā pēc piegādes."
  },
  "lt": {
    "documentTitle": "SIUNTOS LAPAS",
    "orderNumber": "Siuntos lapas nr.",
    "date": "Pakavimo data",
    "reference": "Užsakymo nuoroda nr.",
    "totalLabel": "Supakuota iš viso",
    "itemsInTotalLabel": "Supakuotos prekės",
    "notes": "Patikrinkite turinį pagal šį siuntos lapą.",
    "terms": "Praneškite apie trūkstamas ar pažeistas prekes per 48 valandas nuo pristatymo."
  },
  "ca": {
    "documentTitle": "ALBARÀ D'EMBALATGE",
    "orderNumber": "Albarà d'embalatge núm.",
    "date": "Data d'embalatge",
    "reference": "Ref. comanda núm.",
    "totalLabel": "Total embalat",
    "itemsInTotalLabel": "Articles embalats",
    "notes": "Comproveu el contingut segons aquest albarà d'embalatge.",
    "terms": "Informeu d'articles absents o danyats dins de les 48 hores posteriors a l'entrega."
  },
  "gl": {
    "documentTitle": "ALBARÁ DE EMBALAXE",
    "orderNumber": "Albará de embalaxe nº",
    "date": "Data de embalaxe",
    "reference": "Ref. pedido nº",
    "totalLabel": "Total embalado",
    "itemsInTotalLabel": "Artigos embalados",
    "notes": "Comprobe o contido segundo este albará de embalaxe.",
    "terms": "Informe de artigos faltantes ou danados nas 48 horas seguintes á entrega."
  },
  "eu": {
    "documentTitle": "ONDOEN ZERRENDA",
    "orderNumber": "Ondoen zerrenda#",
    "date": "Ontziolatzeko data",
    "reference": "Eskari erref.#",
    "totalLabel": "Ontziolatuta guztira",
    "itemsInTotalLabel": "Ontziolatutako artikuluak",
    "notes": "Mesedez, egiaztatu edukia ondoen zerrenda honen arabera.",
    "terms": "Jakinarazi falta diren edo hondatutako artikuluak entrega egin eta 48 ordutan."
  },
  "sq": {
    "documentTitle": "LISTË PAKETIMI",
    "orderNumber": "Listë paketimi#",
    "date": "Data e paketimit",
    "reference": "Ref. porosie#",
    "totalLabel": "Total i paketuar",
    "itemsInTotalLabel": "Artikuj të paketuar",
    "notes": "Ju lutemi kontrolloni përmbajtjen sipas kësaj liste paketimi.",
    "terms": "Raportoni artikujt që mungojnë ose janë dëmtuar brenda 48 orëve pas dorëzimit."
  },
  "be": {
    "documentTitle": "ПАКАВАЛЬНЫ ЛІСТ",
    "orderNumber": "Пакавальны ліст №",
    "date": "Дата пакавання",
    "reference": "Спасл. на заказ №",
    "totalLabel": "Усяго запакавана",
    "itemsInTotalLabel": "Запакаваныя пазіцыі",
    "notes": "Калі ласка, праверце зміст па гэтым пакавальным лісту.",
    "terms": "Паведаміце пра адсутнія або пашкоджаныя пазіцыі на працягу 48 гадзін пасля дастаўкі."
  },
  "bs": {
    "documentTitle": "OTPREMNICA",
    "orderNumber": "Otpremnica#",
    "date": "Datum pakovanja",
    "reference": "Ref. narudžbe#",
    "totalLabel": "Ukupno pakovano",
    "itemsInTotalLabel": "Pakovane stavke",
    "notes": "Provjerite sadržaj prema ovoj otpremnici.",
    "terms": "Prijavite nedostajuće ili oštećene stavke u roku od 48 sati od isporuke."
  },
  "mk": {
    "documentTitle": "ПАКУВАЛЕН ЛИСТ",
    "orderNumber": "Пакувален лист#",
    "date": "Датум на пакување",
    "reference": "Реф. на нарачка#",
    "totalLabel": "Вкупно пакувано",
    "itemsInTotalLabel": "Пакувани ставки",
    "notes": "Проверете ја содржината според овој пакувален лист.",
    "terms": "Пријавете недостасувачки или оштетени ставки во рок од 48 часа по доставата."
  },
  "is": {
    "documentTitle": "PÖKKUNARLISTI",
    "orderNumber": "Pökkunarlisti#",
    "date": "Pökkunardagur",
    "reference": "Tilv. pöntunar#",
    "totalLabel": "Pakkað samtals",
    "itemsInTotalLabel": "Pakkaðar vörur",
    "notes": "Athugaðu innihaldið miðað við þennan pökkunarlista.",
    "terms": "Tilkynntu vantar eða skemmdar vörur innan 48 klukkustunda frá afhendingu."
  },
  "ga": {
    "documentTitle": "SLIP PACÁISTEOIREACHTA",
    "orderNumber": "Slip pacáisteoireachta#",
    "date": "Dáta pacáistithe",
    "reference": "Tag. ordú#",
    "totalLabel": "Iomlán pacáistithe",
    "itemsInTotalLabel": "Míreanna pacáistithe",
    "notes": "Seiceáil an t-ábhar i gcoinne an tslip pacáisteoireachta seo.",
    "terms": "Tuairiscigh míreanna ar iarraidh nó damáiste laistigh de 48 uair an chloig tar éis seachadta."
  },
  "cy": {
    "documentTitle": "SLIP PACIO",
    "orderNumber": "Slip pacio#",
    "date": "Dyddiad pacio",
    "reference": "Cyf. archeb#",
    "totalLabel": "Cyfanswm wedi'i becynnu",
    "itemsInTotalLabel": "Eitemau wedi'u pecynnu",
    "notes": "Gwiriwch y cynnwys yn erbyn y slip pacio hwn.",
    "terms": "Rhoi gwybod am eitemau coll neu ddifrodi o fewn 48 awr o ddanfon."
  },
  "mt": {
    "documentTitle": "SLIP TAL-Ippakkjar",
    "orderNumber": "Slip tal-ippakkjar#",
    "date": "Data tal-ippakkjar",
    "reference": "Ref. ordni#",
    "totalLabel": "Total ippakkjat",
    "itemsInTotalLabel": "Oġġetti ippakkjati",
    "notes": "Jekk jogħġbok iċċekkja l-kontenut skont dan is-slip tal-ippakkjar.",
    "terms": "Irrapporta oġġetti nieqsa jew meġġuna fi żmien 48 siegħa mill-kunsinna."
  },
  "lb": {
    "documentTitle": "LIEFERSCHEIN",
    "orderNumber": "Lieferscheinnr.",
    "date": "Packdatum",
    "reference": "Bestellungsref.-Nr.",
    "totalLabel": "Total verpackt",
    "itemsInTotalLabel": "Verpackt Artikelen",
    "notes": "Kontrolléiert den Inhalt mat dësem Lieferschein.",
    "terms": "Mellt feelend oder beschiedegt Artikelen bannent 48 Stonnen no der Liwwerung."
  }
};

function resolve(table, lang) {
  const base = lang.split("-")[0];
  return table[lang] ?? table[base] ?? table.en;
}

function buildTable(base, languages) {
  const out = {};
  for (const lang of languages) {
    out[lang] = resolve(base, lang);
  }
  return out;
}

const creditTable = buildTable(creditBase, TEMPLATE_LANGUAGES);
const packingTable = buildTable(packingBase, TEMPLATE_LANGUAGES);

function formatLabelsObject(table) {
  const lines = ["{"];
  for (const [lang, labels] of Object.entries(table)) {
    lines.push(`  ${JSON.stringify(lang)}: {`);
    for (const [key, value] of Object.entries(labels)) {
      lines.push(`    ${key}: ${JSON.stringify(value)},`);
    }
    lines.push("  },");
  }
  lines.push("}");
  return lines.join("\n");
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outPath = path.join(__dirname, "..", "app", "template-document-type-labels.data.ts");

const ts = `export const CREDIT_NOTE_LABELS: Record<string, DocumentTypeLabelOverrides> = ${formatLabelsObject(creditTable)};

export const PACKING_SLIP_LABELS: Record<string, DocumentTypeLabelOverrides> = ${formatLabelsObject(packingTable)};

export type DocumentTypeLabelOverrides = {
  documentTitle: string;
  orderNumber: string;
  date: string;
  reference: string;
  totalLabel: string;
  itemsInTotalLabel: string;
  notes: string;
  terms: string;
  refundedAmountLabel?: string;
};
`;

fs.writeFileSync(outPath, ts, "utf8");
console.log("Wrote", outPath);
