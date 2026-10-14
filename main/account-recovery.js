function recoverExistingAdmin(database, input, hashPassword) {
  const organization = String(input.organization || '').trim();
  const contact = String(input.contact || '').trim();
  const password = String(input.password || '');
  if (!organization || !contact || password.length < 8) {
    throw new Error('Enter your tuition centre name, the saved contact number, and a new password of at least 8 characters.');
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
  database.prepare('UPDATE users SET password_hash=? WHERE user_id=?')
    .run(`${credentials.salt}:${credentials.hash}`, user.user_id);
  return { user_id: user.user_id, oid: user.oid, username: user.username, organization: user.organization, role: user.role };
}

module.exports = { recoverExistingAdmin };
