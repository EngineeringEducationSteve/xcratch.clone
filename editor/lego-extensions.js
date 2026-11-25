const ids = ['legoble', 'legomario', 'legoluigi', 'legopeach', 'spikeessential'];
const site = new URL('../', import.meta.url);
const modules = new Map(ids.map(id => [id, new URL(`extensions/${id}.js`, site).href]));

function resolveExtensionURL(input) {
    let url;
    try {
        url = new URL(input, site);
    } catch {
        return input;
    }

    const localLegacy = url.origin === site.origin && url.pathname.startsWith(site.pathname)
        ? url.pathname.slice(site.pathname.length)
        : null;
    const legacyPaths = {
        'https://sjcoefablab.org': /^\/(?:fabscratch|extensions)\//,
        'https://bricklife.com': /^\/scratch-gui\/xcratch\//,
        'https://engineeringeducationsteve.github.io': /^\/xcratch\.clone\//
    };
    const legacyPath = legacyPaths[url.origin];
    const filename = localLegacy ?? (legacyPath?.test(url.pathname)
        ? url.pathname.replace(legacyPath, '')
        : '');
    const id = /^(?:extensions\/)?(\w+)\.(?:mjs|js)$/.exec(filename)?.[1];
    return modules.get(id) ?? input;
}

export async function installLegoExtensions(manager, preload) {
    const fetchExtension = manager.fetchExtension.bind(manager);
    manager.fetchExtension = url => fetchExtension(resolveExtensionURL(url));
    if (!preload) return;

    const results = await Promise.allSettled([...modules.values()].map(url => manager.fetchExtension(url)));
    const failures = [];
    for (const result of results) {
        try {
            if (result.status === 'rejected') throw result.reason;
            const {entry, blockClass} = result.value;
            if (!manager.isExtensionLoaded(entry.extensionId)) {
                manager.registerExtensionBlock(entry, blockClass);
            }
        } catch (error) {
            failures.push(error);
        }
    }
    if (failures.length) {
        console.error('Could not load all LEGO extensions:', failures);
        showLegoExtensionError();
    }
}

function showLegoExtensionError() {
    const notice = document.createElement('div');
    notice.setAttribute('role', 'status');
    notice.style.cssText = 'position:fixed;bottom:12px;left:12px;z-index:1000;padding:12px;' +
        'border:1px solid #804000;border-radius:6px;background:#fff4dd;color:#3d2600;font:14px sans-serif';
    notice.textContent = 'Some LEGO extensions could not load. Reload the editor to try again. ';
    const dismiss = document.createElement('button');
    dismiss.type = 'button';
    dismiss.textContent = 'Dismiss';
    dismiss.addEventListener('click', () => notice.remove());
    notice.append(dismiss);
    document.body.append(notice);
}
