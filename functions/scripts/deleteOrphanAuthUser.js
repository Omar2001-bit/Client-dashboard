const path = require("path");
const admin = require("firebase-admin");

const [email] = process.argv.slice(2);

if (!email) {
  console.error("Usage: node scripts/deleteOrphanAuthUser.js <email>");
  process.exit(1);
}

const serviceAccount = require(path.join(__dirname, "..", "serviceAccountKey.json"));

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

async function deleteOrphanAuthUser() {
  const auth = admin.auth();
  const db = admin.firestore();
  const user = await auth.getUserByEmail(email.trim().toLowerCase());
  const profile = await db.collection("users").doc(user.uid).get();

  if (profile.exists) {
    throw new Error(`Refusing to delete ${email}: /users/${user.uid} exists.`);
  }

  await auth.deleteUser(user.uid);
  console.log(`Deleted orphan Auth user: ${email}`);
  console.log(`UID: ${user.uid}`);
}

deleteOrphanAuthUser()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
