const axios = require(`axios`);
const AdmZip = require('adm-zip');
const { createWriteStream } = require(`fs`);
const { rm, mkdir, unlink } = require(`fs/promises`);
const { join } = require(`path`);

const unofficialNotionAPI = `https://www.notion.so/api/v3`;
const { NOTION_TOKEN, NOTION_SPACE_ID, NOTION_USER_ID } = process.env;
const client = axios.create({
  baseURL: unofficialNotionAPI,
  headers: {
    Cookie: `token_v2=${NOTION_TOKEN};`,
    "x-notion-active-user-header": NOTION_USER_ID,
  },
});

if (!NOTION_TOKEN || !NOTION_SPACE_ID || !NOTION_USER_ID) {
  console.error(
    `Environment variable NOTION_TOKEN, NOTION_SPACE_ID or NOTION_USER_ID is missing. Check the README.md for more information.`
  );
  process.exit(1);
}

const sleep = async (seconds) => {
  return new Promise((resolve) => {
    setTimeout(resolve, seconds * 1000);
  });
};

const round = (number) => Math.round(number * 100) / 100;

const exportFromNotion = async (destination, format) => {
  const task = {
    eventName: `exportSpace`,
    request: {
      spaceId: NOTION_SPACE_ID,
      exportOptions: {
        exportType: format,
        timeZone: `Europe/Berlin`,
        locale: `en`,
      },
    },
  };
  const {
    data: { taskId },
  } = await client.post(`enqueueTask`, { task });

  console.log(`Started Export as task [${taskId}].\n`);

  let exportURL;
  while (true) {
    await sleep(2);
    const {
      data: { results: tasks },
    } = await client.post(`getTasks`, { taskIds: [taskId] });
    const task = tasks.find((t) => t.id === taskId);

    if (task.error) {
      console.error(`❌ Export failed with reason: ${task.error}`);
      process.exit(1);
    }

    console.log(`Exported ${task.status.pagesExported} pages.`);

    if (task.state === `success`) {
      exportURL = task.status.exportURL;
      console.log(`\nExport finished.`);
      break;
    }
  }

  const response = await client({
    method: `GET`,
    url: exportURL,
    responseType: `stream`,
  });

  const size = response.headers["content-length"];
  console.log(`Downloading ${round(size / 1000 / 1000)}mb...`);

  const stream = response.data.pipe(createWriteStream(destination));
  await new Promise((resolve, reject) => {
    stream.on(`close`, resolve);
    stream.on(`error`, reject);
  });
};

function extractZip(filename, destination) {
  const zip = new AdmZip(filename);
  zip.extractAllTo(destination, /* overwrite */ true);

  // Check if any files with name ending in "Part-*.zip" were extracted
  const extractedFiles = zip.getEntries().map(entry => entry.entryName);
  const partFiles = extractedFiles.filter(name => name.match(/Part-\d+\.zip/));

  // Extract any "Part-*.zip" files that were found
  partFiles.forEach(partFile => {
    const partZip = new AdmZip(partFile);
    partZip.extractAllTo(destination, /* overwrite */ true);
  });
};

const run = async () => {
  const workspaceDir = join(process.cwd(), `workspace`);
  const workspaceZip = join(process.cwd(), `workspace.zip`);

  await exportFromNotion(workspaceZip, `markdown`);
  await rm(workspaceDir, { recursive: true, force: true });
  await mkdir(workspaceDir, { recursive: true });
  extractZip(workspaceZip, workspaceDir );
  await unlink(workspaceZip);

  console.log(`✅ Export downloaded and unzipped.`);
};

run();
