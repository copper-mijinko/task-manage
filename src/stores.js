import { writable, get } from 'svelte/store';
import { throttle } from 'lodash';
import { THEME_DARK, THEME_LIGHT } from './common/theme'
import _ from 'lodash';
import { getDefaultProject, getNode, filterTree } from './common/tree_control.ts';

// info
export const info_ids = writable([{ id: "9ba28822-6240-4280-9da3-63ac6b8356a6", name: "Usage" }]);

// Control projects.
//  project_ids       : To add or delete project. 
//  tree_data         : To control data of the selected project.
// Meta data.
//  theme             : ("dark"|"light")
// Only for ui.
//  selected_type     : (undefined|"Projects"|"Info") to show main page.
//  table_selected_id : Selected id of the table row.
//  not_expanded_ids  : Ids of not expanded rows.
//  selected_id       : The project_id or info_id.
//  filter            : Key value(list) data for filtering. ex) {"status": ["Open", "In Progress"]}
//  filtered_data     : Filtered tree_data.data.

export let project_ids;
export let tree_data;
export let selected_type;
export let table_selected_id;
export let not_expanded_ids;
export let selected_id;
export let theme;
export let filter;
export let filtered_data;

function createProjectIds(project_ids) {
	const { subscribe, set, update } = writable(project_ids);
	return {
		subscribe,
		set,
		update,
		init: () => {
			subscribe(current => {
				if (current === undefined) {
					window.electronAPI.getProjectIDs().then(
						(result) => {
							current = result;
						}
					)
				}
				if (!current || current.length == 0) {
					selected_type.set(undefined);
					table_selected_id.set(undefined);
					not_expanded_ids.set(new Set());
				}
			})
		},
		addProject: () => {
			const new_project = getDefaultProject();
			window.electronAPI.addProject(new_project);
			window.electronAPI.getProjectIDs().then(
				(result) => {
					set(result);
				}
			);
		},
		deleteProject: (project_id) => {
			window.electronAPI.deleteProject(project_id);
			window.electronAPI.getProjectIDs().then((result) => { set(result); });
			if (project_id == get(selected_id)) {
				selected_type.set(undefined);
				selected_id.set(undefined);
			}
		},
		setProjectOrder: (projects) => {
			// プロジェクトの順序を保存
			window.electronAPI.setProjectOrder(projects);
			// UIを更新（すでにupdateで更新されているため、ここでは何もしない）
		}
	}
}

function createTreeData(tree_data) {
	const { subscribe, set, update } = writable(tree_data);
	let setTreeData = throttle((current) => {
		// update filtered in ui.
		filter.set(get(filter));
		// update tree data db.
		window.electronAPI.setTreeData(current);
		// when project_name updated.
		window.electronAPI.getProjectIDs().then((result) => { project_ids.set(result); })
	}, 1000);
	return {
		subscribe,
		set,
		update,
		init: () => {
			subscribe(current => {
				if (current === undefined) {
					window.electronAPI.getInitialTreeData().then(
						(result) => {
							setTreeData(current);
							selected_type.set("Projects");
							selected_id.set(result.data.id);
						}
					)
				} else { }
				setTreeData(current);
			});
		}
	}
}

function createSelectedID(id) {
	const { subscribe, set, update } = writable(id);
	return {
		subscribe,
		set,
		update,
		init: () => {
			subscribe(current => {
				// on selected_id changed, load project
				let current_selected_type = get(selected_type);
				if (current_selected_type == "Projects") {
					window.electronAPI.getTreeData(current).then((result) => {
						tree_data.set(result);
					});
					table_selected_id.set(undefined);
				}
			})
		}
	}
}

function createTheme(theme) {
	const { subscribe, set, update } = writable(theme);
	const traverse = (theme, varString) => {
		const keys = Object.keys(theme);
		Object.keys(theme).forEach((key) => {
			let varString2 = `${varString}-${key}`;
			if (theme[key].constructor === Object && !theme[key].length) {
				traverse(theme[key], varString2);
			} else {
				document.documentElement.style.setProperty(varString2, theme[key]);
			}
		})
	}
	return {
		subscribe,
		set,
		update,
		init: () => {
			subscribe(current => {
				if (current === undefined) {
					window.electronAPI.getMetaData("theme").then(
						(result) => {
							set(result);
						}
					);
				}
				if (current == "dark") {
					traverse(THEME_DARK, "--theme");
					window.electronAPI.setMetaData("theme", current);
				} else if (current == "light") {
					traverse(THEME_LIGHT, "--theme");
					window.electronAPI.setMetaData("theme", current);
				}
			})
		},
	}
};

function createFilter(filter) {
	const { subscribe, set, update } = writable(filter);
	return {
		subscribe,
		set,
		update,
		init: () => {
			subscribe(current => {
				if (!current) return;
				const current_tree_data = get(tree_data);
				if (!current_tree_data) return;
				let filtered = JSON.parse(JSON.stringify(current_tree_data.data));
				filtered = filterTree(filtered, current)
				if (get(table_selected_id) && filtered && getNode(get(table_selected_id), filtered)) {
					;
				} else {
					table_selected_id.set(undefined);
				}
				filtered_data.set(filtered);
			})
		}
	}
}

tree_data = createTreeData(undefined);
project_ids = createProjectIds(undefined);
selected_type = writable(undefined);
table_selected_id = writable(undefined);
not_expanded_ids = writable(new Set()); // for default expanded.
selected_id = createSelectedID(undefined);
theme = createTheme(undefined);
filter = createFilter({})
filtered_data = writable(tree_data.data)

export function init_store() {
	// Get initial data of a project from db.
	tree_data.init();
	project_ids.init();
	selected_id.init();
	filter.init();
	// Set theme
	theme.init();
}
