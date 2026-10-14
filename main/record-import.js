const ExcelJS = require('exceljs');

const definitions = {
  students: {
    columns: [
      ['Name', 'name'],
      ['School', 'school'],
      ['Primary Contact', 'contact1'],
      ['Other Contact', 'contact2'],
      ['Birthday', 'birthday'],
      ['Address', 'address'],
      ['Status', 'status']
    ],
    aliases: {
      name: 'name',
      studentname: 'name',
      school: 'school',
      primarycontact: 'contact1',
      contact1: 'contact1',
      phone: 'contact1',
      phone1: 'contact1',
      othercontact: 'contact2',
      secondarycontact: 'contact2',
      contact2: 'contact2',
      phone2: 'contact2',
      birthday: 'birthday',
      dateofbirth: 'birthday',
      dob: 'birthday',
      address: 'address',
      status: 'status'
    }
  },
  teachers: {
    columns: [
      ['Name', 'name'],
      ['Contact', 'contact'],
      ['Address', 'address'],
      ['Description', 'description']
    ],
    aliases: {
      name: 'name',
      teachername: 'name',
      contact: 'contact',
      phone: 'contact',
      phonenumber: 'contact',
      address: 'address',
      description: 'description',
      about: 'description'
    }
  },
  'teacher-opening-balances': {
    columns: [
      ['Teacher Name', 'name'],
      ['Opening Balance', 'opening_balance'],
      ['Notes', 'notes']
    ],
    aliases: {
      name: 'name',
      teacher: 'name',
      teachername: 'name',
      openingbalance: 'opening_balance',
      pendingpayment: 'opening_balance',
      pendingamount: 'opening_balance',
      amount: 'opening_balance',
      notes: 'notes'
    }
  }
};

const normalizeHeader = (value) => String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const cellValue = (value) => {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value;
  if (typeof value === 'object') return value.text || '';
  return value;
};

function normalizeBirthday(value) {
  if (!value) return null;
  let date;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    date = value;
  } else if (typeof value === 'number' && Number.isFinite(value)) {
    date = new Date(Date.UTC(1899, 11, 30) + value * 86400000);
  } else if (typeof value === 'string') {
    const input = value.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(input)) {
      const parsed = new Date(`${input}T00:00:00Z`);
      if (!Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === input) return input;
    }
    const parsed = new Date(input);
    if (!Number.isNaN(parsed.getTime())) date = parsed;
  }
  if (!date || Number.isNaN(date.getTime())) throw new Error('Birthday must be a valid Excel date or YYYY-MM-DD.');
  return date.toISOString().slice(0, 10);
}

async function parseExcelRecords(buffer, kind) {
  const definition = definitions[kind];
  if (!definition) throw new Error('Choose student or teacher records to import.');
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buffer);
  } catch {
    throw new Error('The selected file is not a readable Excel workbook.');
  }
  const sheet = workbook.worksheets[0];
  if (!sheet) throw new Error('The Excel workbook does not contain a worksheet.');
  if (sheet.rowCount > 5001) throw new Error('Import files can contain at most 5,000 records.');
  const headers = sheet.getRow(1).values.slice(1).map(normalizeHeader);
  const mappedHeaders = headers.map((header) => definition.aliases[header] || null);
  const required = kind === 'students' ? ['name', 'contact1']
    : kind === 'teacher-opening-balances' ? ['name', 'opening_balance']
      : ['name'];
  const missing = required.filter((column) => !mappedHeaders.includes(column));
  if (missing.length) {
    const labels = missing.map((column) => definition.columns.find(([, key]) => key === column)[0]);
    throw new Error(`Missing required Excel column${labels.length > 1 ? 's' : ''}: ${labels.join(', ')}.`);
  }

  const records = [];
  const errors = [];
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const cells = row.values.slice(1).map(cellValue);
    if (cells.every((value) => value === '' || value === null || value === undefined)) return;
    const record = {};
    mappedHeaders.forEach((column, index) => {
      if (column) record[column] = cells[index] ?? '';
    });
    for (const key of Object.keys(record)) {
      if (key !== 'birthday') record[key] = String(record[key] ?? '').trim();
    }
    if (!record.name) errors.push(`Row ${rowNumber}: name is required.`);
    if (kind === 'students' && !record.contact1) errors.push(`Row ${rowNumber}: primary contact is required.`);
    if (kind === 'students') {
      try {
        record.birthday = normalizeBirthday(record.birthday);
      } catch (error) {
        errors.push(`Row ${rowNumber}: ${error.message}`);
      }
      record.status = (record.status || 'active').toLowerCase();
      if (!['active', 'inactive'].includes(record.status)) errors.push(`Row ${rowNumber}: status must be active or inactive.`);
    } else if (kind === 'teacher-opening-balances') {
      const rawAmount = record.opening_balance;
      const amount = typeof rawAmount === 'number'
        ? rawAmount
        : Number(String(rawAmount || '').trim());
      if (rawAmount === '' || rawAmount === null || rawAmount === undefined ||
        !Number.isFinite(amount) || amount < 0 || amount > 1_000_000_000_000) {
        errors.push(`Row ${rowNumber}: opening balance must be a number from 0 to 1,000,000,000,000.`);
      } else if (Math.round(amount * 100) / 100 !== amount) {
        errors.push(`Row ${rowNumber}: opening balance can have at most two decimal places.`);
      } else {
        record.opening_balance = amount;
      }
    }
    records.push(record);
  });
  if (errors.length) throw new Error(`Excel import contains invalid rows:\n${errors.slice(0, 10).join('\n')}${errors.length > 10 ? `\nAnd ${errors.length - 10} more error(s).` : ''}`);
  if (!records.length) throw new Error('The Excel worksheet has no records to import.');
  return records;
}

async function createTemplateBuffer(kind) {
  const definition = definitions[kind];
  if (!definition) throw new Error('Choose student or teacher records to import.');
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Tuition Manager';
  const sheet = workbook.addWorksheet(kind === 'students' ? 'Students'
    : kind === 'teacher-opening-balances' ? 'Opening Balances' : 'Teachers');
  sheet.columns = definition.columns.map(([header, key]) => ({
    header,
    key,
    width: Math.max(header.length + 5, 20),
    numFmt: ['contact', 'contact1', 'contact2'].includes(key) ? '@'
      : key === 'birthday' ? 'yyyy-mm-dd'
        : key === 'opening_balance' ? '0.00' : undefined
  }));
  sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF7357DC' } };
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  return workbook.xlsx.writeBuffer();
}

module.exports = { createTemplateBuffer, parseExcelRecords };
