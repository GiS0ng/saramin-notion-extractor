import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// core.js는 CommonJS/UMD 모듈이라 createRequire로 불러온다. SKILL_CATALOG/SKILL_ALIASES가
// GitHub 매칭(backend/app/skills.py)에도 쓰이는 스킬 어휘의 단일 출처다 — core.js를 고쳤으면
// 이 스크립트를 다시 돌려서 shared/skill-catalog.json을 갱신해야 한다
// (.github/workflows/ci.yml이 이걸 안 하면 CI에서 잡아낸다).
const require = createRequire(import.meta.url);
const rootDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const { SKILL_CATALOG, SKILL_ALIASES } = require(join(rootDir, "core.js"));

const outDir = join(rootDir, "shared");
const outFile = join(outDir, "skill-catalog.json");

mkdirSync(outDir, { recursive: true });
writeFileSync(outFile, `${JSON.stringify({ SKILL_CATALOG, SKILL_ALIASES }, null, 2)}\n`, "utf8");
console.log(`${outFile} 갱신 완료 (스킬 ${SKILL_CATALOG.length}개)`);
