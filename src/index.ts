import { exec } from "child_process";
import fs from "fs";
import path from "path";

const exporterPath = "C:/Users/strik/Desktop/Programs/Typescript/VTRipper/AssetRipper/Source/0Bins/AssetRipper.CLI/Debug/AssetRipper.CLI.exe";
const vtolPath = "C:/Program Files (x86)/Steam/steamapps/common/VTOL VR";

const outDir = path.resolve("../out");

function recursiveDelete(path: string, tl = true) {
	if (!fs.existsSync(path)) return;
	fs.readdirSync(path).forEach(file => {
		const curPath = path + "/" + file;
		if (fs.lstatSync(curPath).isDirectory()) {
			recursiveDelete(curPath, false);
			fs.rmdirSync(curPath);
		} else {
			fs.unlinkSync(curPath);
		}
	});

	if (tl) fs.rmdirSync(path);
}

function preClean() {
	recursiveDelete(outDir);
	fs.mkdirSync(outDir);
}

async function ripProject() {
	const command = `"${exporterPath}" unityproject "${vtolPath}" "${outDir}"`;
	console.log(`Executing command: ${command}`);

	const cp = exec(command);

	cp.stdout.on("data", data => {
		const m = (data ?? "").trim();
		if (m.length > 0) console.log(m);
	});

	await new Promise(res => cp.on("exit", res));
}

function formatProject() {
	recursiveDelete(outDir + "/AuxiliaryFiles");
	const childFiles = fs.readdirSync(outDir + "/ExportedProject");
	for (const file of childFiles) {
		fs.renameSync(outDir + "/ExportedProject/" + file, outDir + "/" + file);
	}

	fs.rmdirSync(outDir + "/ExportedProject");

	// Delete all the folders (except maps) from the scenes folder, then the akutan folder in the maps folder
	const scenes = fs.readdirSync(outDir + "/Assets/Scenes");
	scenes.forEach(scene => {
		const fpath = outDir + "/Assets/Scenes/" + scene;
		if (fs.lstatSync(fpath).isDirectory() && scene !== "Maps") {
			console.log(`Deleting scene folder ${fpath}`);
			recursiveDelete(fpath);
		}
	});
	console.log(`Deleting Akutan folder`);
	recursiveDelete(outDir + "/Assets/Scenes/Maps/Akutan");

	// Delete all the Unity.. dlls & the Assembly-CSharp-firstpass folder in the plugins folder
	const plugins = fs.readdirSync(outDir + "/Assets/Plugins");
	plugins.forEach(plugin => {
		const fpath = outDir + "/Assets/Plugins/" + plugin;
		if (plugin.startsWith("Unity.")) {
			console.log(`Deleting unity DLL ${fpath}`);
			fs.unlinkSync(fpath);
		}
	});
	recursiveDelete(outDir + "/Assets/Plugins/Assembly-CSharp-firstpass");

	const pluginsPath = outDir + "/Assets/Plugins";
	const extraDeleteDlls = ["SteamVR.dll", "SteamVR_Actions.dll"];
	extraDeleteDlls.forEach(dll => {
		const fpath = pluginsPath + "/" + dll;
		fs.unlinkSync(fpath);
	});

	// Copy the following dlls from the games managed folder into the plugins folder.
	const dlls = [
		"Assembly-CSharp-firstpass.dll",
		"System.Memory.dll",
		"System.Buffers.dll",
		"Unity.XR.Oculus.dll",
		"Unity.XR.OpenVR.dll",
		"System.Runtime.CompilerServices.Unsafe.dll"
	];

	const managedPath = vtolPath + "/VTOLVR_Data/Managed";
	dlls.forEach(dll => {
		fs.copyFileSync(managedPath + "/" + dll, pluginsPath + "/" + dll);
	});
}

function editManifest() {
	const manifestPath = outDir + "/Packages/manifest.json";
	const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));

	manifest.dependencies["com.unity.formats.fbx"] = "5.1.1";
	manifest.dependencies["com.unity.textmeshpro"] = "3.0.6";
	manifest.dependencies["com.unity.xr.management"] = "4.0.7";
	manifest.dependencies["com.unity.xr.openxr"] = "1.2.8";

	fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
}

function copyInDLLs() {
	const files = fs.readdirSync("../SPlugins");
	const pluginsOutputPath = outDir + "/Assets/Scripts/SPlugins";
	fs.mkdirSync(pluginsOutputPath);

	files.forEach(file => {
		console.log(`Copying ${file}`);
		fs.copyFileSync("../SPlugins/" + file, pluginsOutputPath + "/" + file);
	});
}

function recursivelyGetFiles(dir: string): string[] {
	const files = fs.readdirSync(dir);
	let allFiles: string[] = [];
	files.forEach(file => {
		const fpath = dir + "/" + file;
		if (fs.lstatSync(fpath).isDirectory()) {
			allFiles = allFiles.concat(recursivelyGetFiles(fpath));
		} else {
			allFiles.push(fpath);
		}
	});

	return allFiles;
}

function fixScripts() {
	const getTransformBugTargetPath = outDir + "/Assets/Scripts/Assembly-CSharp/UnityEngine/UI";

	const files = recursivelyGetFiles(getTransformBugTargetPath).filter(f => f.endsWith(".cs"));

	files.forEach(file => {
		const content = fs.readFileSync(file, "utf8");
		const newContent = content.replaceAll(/\[SpecialName\]\r?\n.+\.get_transform\(\)[\w\W]+?}/g, "");
		if (newContent !== content) {
			console.log(`Fixing ${file}`);
			fs.writeFileSync(file, newContent);
		}
	});
}

enum Stage {
	PreClean,
	RipProject,
	FormatProject,
	EditManifest,
	CopyDlls,
	FixScripts
}

const stageHandlers: Record<Stage, () => Promise<void> | void> = {
	[Stage.PreClean]: preClean,
	[Stage.RipProject]: ripProject,
	[Stage.FormatProject]: formatProject,
	[Stage.EditManifest]: editManifest,
	[Stage.CopyDlls]: copyInDLLs,
	[Stage.FixScripts]: fixScripts
};

let stage = Stage.FixScripts;
function nextStage() {
	let next = stage + 1;
	if (Stage[next]) {
		stage = next;
		return true;
	} else {
		return false;
	}
}

async function run() {
	do {
		console.log(`Executing stage: ${Stage[stage]}`);
		const handler = stageHandlers[stage];
		await handler();
	} while (nextStage());
}

run();
