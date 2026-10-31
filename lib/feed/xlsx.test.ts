import { test } from "node:test";
import assert from "node:assert/strict";
import { deflateRawSync } from "node:zlib";
import { parseBytes, suggestFields, toStockRows } from "./parse";
import { readXlsx } from "./xlsx";

/** Ελάχιστο .xlsx (zip με deflate) για τις δοκιμές — μόνο όσα αρχεία διαβάζει ο αναγνώστης. */
function makeXlsx(files: Record<string, string>): Buffer {
  const locals: Buffer[] = [], centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const raw = Buffer.from(text, "utf8"), data = deflateRawSync(raw), n = Buffer.from(name);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(8, 8); lh.writeUInt32LE(data.length, 18); lh.writeUInt32LE(raw.length, 22); lh.writeUInt16LE(n.length, 26);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(8, 10); ch.writeUInt32LE(data.length, 20); ch.writeUInt32LE(raw.length, 24); ch.writeUInt16LE(n.length, 28); ch.writeUInt32LE(offset, 42);
    locals.push(lh, n, data); centrals.push(ch, n);
    offset += 30 + n.length + data.length;
  }
  const cd = Buffer.concat(centrals), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(centrals.length / 2, 8); end.writeUInt16LE(centrals.length / 2, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

const shared = `<sst><si><t>Τιμοκατάλογος &amp; στοκ</t></si><si><t>Κωδικός</t></si><si><t>Barcode</t></si><si><t>Περιγραφή</t></si><si><t>Απόθεμα</t></si><si><t>Κατάστημα</t></si><si><t>Ψυγείο Α+</t></si><si><t>Αθήνα</t></si></sst>`;
const sheet = `<worksheet><sheetData>
<row r="1"><c r="A1" t="s"><v>0</v></c></row>
<row r="3"><c r="A3" t="s"><v>1</v></c><c r="B3" t="s"><v>2</v></c><c r="C3" t="s"><v>3</v></c><c r="D3" t="s"><v>4</v></c><c r="E3" t="s"><v>5</v></c></row>
<row r="4"><c r="A4" t="inlineStr"><is><t>ΨΥΓ-01</t></is></c><c r="B4"><v>5201234567890</v></c><c r="C4" t="s"><v>6</v></c><c r="D4"><v>3</v></c><c r="E4" t="s"><v>7</v></c></row>
<row r="5"><c r="A5" t="inlineStr"><is><t>ΨΥΓ-02</t></is></c><c r="B5"><v>5201234567891</v></c><c r="D5"><v>0</v></c><c r="E5" t="s"><v>7</v></c></row>
<row r="6"/>
<row r="7"><c r="A7" t="inlineStr"><is><t>ΨΥΓ-03</t></is></c><c r="D7"><v>2</v></c></row>
</sheetData></worksheet>`;
const xlsx = makeXlsx({ "xl/sharedStrings.xml": shared, "xl/worksheets/sheet1.xml": sheet });

test("xlsx: κοινά/inline κείμενα, αριθμοί, κενά κελιά", () => {
  const rows = readXlsx(xlsx);
  assert.equal(rows[0][0], "Τιμοκατάλογος & στοκ");
  assert.equal(rows.length, 6); // η κενή γραμμή <row/> μετράει, δεν καταπίνει την επόμενη
  assert.deepEqual(rows[3], ["ΨΥΓ-02", "5201234567891", "", "0", "Αθήνα"]);
});

test("xlsx: αυτόματη αναγνώριση από τα bytes, κεφαλίδα κάτω από τίτλο, στήλες και στοκ", () => {
  const p = parseBytes(xlsx, "auto");
  assert.equal(p.format, "xlsx");
  assert.equal(p.rows.length, 3);
  const hints = suggestFields(p.columns, p.rows);
  assert.equal(hints.sku, "Κωδικός");
  assert.equal(hints.ean, "Barcode");
  assert.equal(hints.qty, "Απόθεμα");
  assert.equal(hints.location, "Κατάστημα");
  const stock = toStockRows(p.rows, hints);
  assert.deepEqual(stock[0], { externalSku: "ΨΥΓ-01", ean: "5201234567890", title: "Ψυγείο Α+", locationRef: "Αθήνα", qty: 3 });
});

test("παλιό .xls: καθαρό μήνυμα", () => {
  const ole = Buffer.from("d0cf11e0a1b11ae1" + "00".repeat(32), "hex");
  assert.throws(() => parseBytes(ole, "auto"), /\.xls/);
});

test("μη έγκυρο xlsx απορρίπτεται", () => {
  assert.throws(() => parseBytes(Buffer.from("PK\x03\x04σκουπίδια"), "xlsx"));
});
