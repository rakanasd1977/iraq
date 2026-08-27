const { db, run, all, get } = require('../index');

module.exports = {
  name: "016_provider_verification",
  up: ()=>{db.exec("ALTER TABLE providers ADD COLUMN national_id_image TEXT;");db.exec("ALTER TABLE providers ADD COLUMN residency_doc_image TEXT;");db.exec("ALTER TABLE providers ADD COLUMN verification_status TEXT NOT NULL DEFAULT 'none';");db.exec("ALTER TABLE providers ADD COLUMN verification_note TEXT;");db.exec("ALTER TABLE providers ADD COLUMN submitted_at TEXT;");db.exec("ALTER TABLE providers ADD COLUMN reviewed_at TEXT;");db.exec("UPDATE providers SET verification_status = CASE WHEN is_verified = 1 THEN 'approved' ELSE 'none' END;")},
};
