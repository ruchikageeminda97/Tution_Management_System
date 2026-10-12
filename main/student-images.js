const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const MAX_IMAGE_SIZE = 2 * 1024 * 1024;

function imageMime(image) {
  if (image[0] === 0xff && image[1] === 0xd8 && image[2] === 0xff) return 'image/jpeg';
  if (image.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (image.subarray(0, 4).toString('ascii') === 'RIFF' && image.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  return null;
}

function decodeImageData(data) {
  const match = typeof data === 'string'
    ? data.match(/^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/)
    : null;
  const image = match ? Buffer.from(match[2], 'base64') : null;
  const mime = image && imageMime(image);
  if (!match || !image.length || image.length > MAX_IMAGE_SIZE ||
      image.toString('base64') !== match[2] || mime !== `image/${match[1]}`) {
    throw new Error('Choose a valid JPEG, PNG or WebP student photo up to 2 MB.');
  }
  return { image, mime };
}

function ensureImageDirectory(directory) {
  if (typeof directory !== 'string' || !directory.trim()) {
    throw new Error('Choose a folder for student photos.');
  }
  const resolved = path.resolve(directory.trim());
  fs.mkdirSync(resolved, { recursive: true });
  if (!fs.statSync(resolved).isDirectory()) throw new Error('The student photo location must be a folder.');
  return resolved;
}

function writeStudentImage(directory, stid, data) {
  const { image, mime } = decodeImageData(data);
  const extension = mime === 'image/jpeg' ? 'jpg' : mime.slice('image/'.length);
  const filePath = path.join(ensureImageDirectory(directory), `student-${stid}-${crypto.randomUUID()}.${extension}`);
  fs.writeFileSync(filePath, image, { flag: 'wx' });
  return filePath;
}

function readStudentImage(filePath) {
  if (!filePath) return null;
  const image = fs.readFileSync(filePath);
  const mime = imageMime(image);
  if (!mime || image.length > MAX_IMAGE_SIZE) throw new Error('The saved student photo is not a valid supported image.');
  return `data:${mime};base64,${image.toString('base64')}`;
}

function removeFiles(filePaths) {
  for (const filePath of filePaths) {
    try {
      fs.rmSync(filePath, { force: true });
    } catch (error) {
      console.warn(`Unable to remove an unused student photo at ${filePath}:`, error);
    }
  }
}

function migrateLegacyStudentPhotos(db, defaultDirectory) {
  const organizationColumns = new Set(db.pragma('table_info(organizations)').map(column => column.name));
  if (!organizationColumns.has('image_directory')) {
    db.exec('ALTER TABLE organizations ADD COLUMN image_directory TEXT');
  }
  const studentColumns = new Set(db.pragma('table_info(students)').map(column => column.name));
  if (!studentColumns.has('photo_path')) db.exec('ALTER TABLE students ADD COLUMN photo_path TEXT');
  const fallbackDirectory = ensureImageDirectory(defaultDirectory);
  db.prepare('UPDATE organizations SET image_directory=? WHERE image_directory IS NULL OR image_directory=?')
    .run(fallbackDirectory, '');

  if (!studentColumns.has('photo_data')) return;
  const legacyPhotos = db.prepare(`SELECT s.stid,s.photo_data,o.image_directory
    FROM students s JOIN organizations o ON o.oid=s.oid
    WHERE s.photo_data IS NOT NULL AND s.photo_data!=''`).all();
  const createdFiles = [];
  const migrations = [];
  try {
    for (const student of legacyPhotos) {
      const filePath = writeStudentImage(student.image_directory || fallbackDirectory, student.stid, student.photo_data);
      createdFiles.push(filePath);
      migrations.push({ stid: student.stid, filePath });
    }
    db.transaction(() => {
      const update = db.prepare('UPDATE students SET photo_path=?,photo_data=NULL WHERE stid=?');
      for (const migration of migrations) update.run(migration.filePath, migration.stid);
      db.exec('ALTER TABLE students DROP COLUMN photo_data');
    })();
  } catch (error) {
    removeFiles(createdFiles);
    throw error;
  }
}

function changeImageDirectory(db, oid, directory) {
  const newDirectory = ensureImageDirectory(directory);
  const organization = db.prepare('SELECT image_directory FROM organizations WHERE oid=?').get(oid);
  if (!organization) throw new Error('Organization not found.');
  const oldDirectory = organization.image_directory;
  if (oldDirectory && path.resolve(oldDirectory).toLowerCase() === newDirectory.toLowerCase()) {
    return newDirectory;
  }

  const students = db.prepare('SELECT stid,photo_path FROM students WHERE oid=? AND photo_path IS NOT NULL').all(oid);
  const copied = [];
  const replacements = [];
  try {
    for (const student of students) {
      const data = readStudentImage(student.photo_path);
      const filePath = writeStudentImage(newDirectory, student.stid, data);
      copied.push(filePath);
      replacements.push({ stid: student.stid, oldPath: student.photo_path, newPath: filePath });
    }
    db.transaction(() => {
      const updateStudent = db.prepare('UPDATE students SET photo_path=? WHERE stid=? AND oid=?');
      for (const replacement of replacements) {
        updateStudent.run(replacement.newPath, replacement.stid, oid);
      }
      db.prepare('UPDATE organizations SET image_directory=? WHERE oid=?').run(newDirectory, oid);
    })();
  } catch (error) {
    removeFiles(copied);
    throw error;
  }

  removeFiles(replacements
    .filter(replacement => !db.prepare('SELECT 1 FROM students WHERE photo_path=? LIMIT 1').get(replacement.oldPath))
    .map(replacement => replacement.oldPath));
  return newDirectory;
}

module.exports = {
  changeImageDirectory,
  decodeImageData,
  ensureImageDirectory,
  migrateLegacyStudentPhotos,
  removeFiles,
  readStudentImage,
  writeStudentImage
};
