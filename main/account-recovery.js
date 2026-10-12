function recoverExistingAdmin(database, input, hashPassword) {
  const organization = String(input.organization || '').trim();
  const contact = String(input.contact || '').trim();
  const username = String(input.username || '').trim();
  const password = String(input.password || '');
  if (!organization || !username || password.length < 8) {
    throw new Error('Enter your tuition centre name, a new username, and a password of at least 8 characters.');
  }

  const matches = database.prepare(`SELECT o.oid,o.name AS organization,u.user_id,u.username,u.role
    FROM organizations o JOIN users u ON u.oid=o.oid
    WHERE o.name=? COLLATE NOCASE AND trim(COALESCE(o.contact,''))=? COLLATE NOCASE AND u.role='admin'`)
    .all(organization, contact);
  if (matches.length !== 1) {
    throw new Error('We could not verify one administrator account with those workspace details.');
  }

  const user = matches[0];
  const credentials = hashPassword(password);
  try {
    database.prepare('UPDATE users SET username=?,password_hash=? WHERE user_id=?')
      .run(username, `${credentials.salt}:${credentials.hash}`, user.user_id);
  } catch (error) {
    if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      throw new Error('That username is already in use. Choose another username.');
    }
    throw error;
  }
  return { user_id: user.user_id, oid: user.oid, username, organization: user.organization, role: user.role };
}

module.exports = { recoverExistingAdmin };
