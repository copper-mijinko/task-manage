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
//  closed_node_ids   : Set of ids of closed nodes.
// Only for ui.
//  selected_type     : (undefined|"Projects"|"Info") to show main page.
//  table_selected_id : Selected id of the table row.
//  selected_id       : The project_id or info_id.
//  filter            : Key value(list) data for filtering. ex) {"status": ["Open", "In Progress"]}
//  filtered_data     : Filtered tree_data.data.

export let project_ids;
export let tree_data;
export let selected_type;
export let table_selected_id;
export let closed_node_ids;
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
					// プロジェクトがない場合は空のセットにリセット
					closed_node_ids.update(() => new Set());
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

			// プロジェクト削除時に関連するメタデータも削除
			const metaKey = `closed_nodes_${project_id}`;
			window.electronAPI.deleteMetaData(metaKey);
			console.log(`プロジェクト削除によりメタデータを完全に削除: ${metaKey}`);

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
	let previousData = null;

	// ツリーデータから削除されたノードのIDを検出
	const findRemovedNodeIds = (oldData, newData) => {
		if (!oldData || !newData) return [];

		// 削除されたノードを検出する関数
		const collectNodeIds = (node) => {
			if (!node) return [];
			const ids = [node.id];
			if (node.children && node.children.length > 0) {
				for (const child of node.children) {
					ids.push(...collectNodeIds(child));
				}
			}
			return ids;
		};

		// 古いデータと新しいデータからすべてのノードIDを収集
		const oldIds = oldData.data ? collectNodeIds(oldData.data) : [];
		const newIds = newData.data ? collectNodeIds(newData.data) : [];

		// 古いデータにあって新しいデータにないIDを見つける
		return oldIds.filter(id => !newIds.includes(id));
	};

	let setTreeData = throttle((current) => {
		// 削除されたノードのメタデータをクリーンアップ
		if (previousData) {
			const removedIds = findRemovedNodeIds(previousData, current);
			if (removedIds.length > 0) {
				const projectId = get(selected_id);
				if (projectId) {
					// 削除されたノードのIDをclosed_node_idsから削除
					closed_node_ids.update(currentState => {
						const newState = new Set(currentState);
						removedIds.forEach(id => {
							newState.delete(id);
						});

						// メタデータに保存
						const metaKey = `closed_nodes_${projectId}`;
						const idsArray = Array.from(newState);
						console.log(`ノード削除による状態更新: ${metaKey}`, idsArray);
						window.electronAPI.setMetaData(metaKey, idsArray);

						return newState;
					});
				}
			}
		}

		// 現在のデータを保存
		previousData = _.cloneDeep(current);

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
							if (result === undefined) {
								;
							} else {
								selected_id.set(result.data.id);
							}
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
// ノードの閉じている状態を管理するストア（閉じているノードのIDのセット）
// 指定されたノードとその子孫ノードのIDをすべて収集する関数
function collectNodeAndDescendantIds(node) {
	if (!node) return [];

	const ids = [node.id];
	if (node.children && node.children.length > 0) {
		for (const child of node.children) {
			ids.push(...collectNodeAndDescendantIds(child));
		}
	}
	return ids;
}

function createClosedNodeIds(ids) {
	// 各プロジェクトのノード開閉状態を保持
	// プロジェクトID -> Set(閉じているノードID) のマップ
	const projectExpandedStates = new Map();

	// 現在のプロジェクトの閉じているノードIDのセット
	const { subscribe, set, update } = writable(ids || new Set());

	// メタデータから状態を読み込む
	const loadState = async (projectId) => {
		if (!projectId) return;

		try {
			const metaKey = `closed_nodes_${projectId}`;
			const result = await window.electronAPI.getMetaData(metaKey);
			console.log(`読み込み: ${metaKey}`, result);

			let newState;
			if (result && Array.isArray(result)) {
				newState = new Set(result);
				projectExpandedStates.set(projectId, newState);
			} else {
				newState = new Set();
				projectExpandedStates.set(projectId, newState);
			}

			set(newState);
			return newState;
		} catch (error) {
			console.error("状態読み込みエラー:", error);
			return new Set();
		}
	};

	// メタデータに状態を保存
	const saveState = (projectId, state) => {
		if (!projectId) return;

		try {
			const metaKey = `closed_nodes_${projectId}`;
			const idsArray = Array.from(state);
			console.log(`保存: ${metaKey}`, idsArray);
			window.electronAPI.setMetaData(metaKey, idsArray);
		} catch (error) {
			console.error("状態保存エラー:", error);
		}
	};

	return {
		subscribe,
		set,
		update,

		add: (nodeId) => {
			const projectId = get(selected_id);
			if (!projectId) return;

			update(currentState => {
				const newState = new Set(currentState);
				newState.add(nodeId);

				// 状態をマップに保存
				projectExpandedStates.set(projectId, newState);

				// メタデータに保存
				saveState(projectId, newState);

				return newState;
			});
		},

		delete: (nodeId) => {
			const projectId = get(selected_id);
			if (!projectId) return;

			update(currentState => {
				const newState = new Set(currentState);
				newState.delete(nodeId);

				// 状態をマップに保存
				projectExpandedStates.set(projectId, newState);

				// メタデータに保存
				saveState(projectId, newState);

				return newState;
			});
		},

		// 初期化
		init: () => {
			// プロジェクト変更時に対応する状態をロード
			selected_id.subscribe(async (projectId) => {
				if (projectId) {
					// すでに読み込み済みの状態があればそれを使用
					if (projectExpandedStates.has(projectId)) {
						set(projectExpandedStates.get(projectId));
					} else {
						// なければ読み込み
						await loadState(projectId);
					}
				}
			});
		},

		// 指定されたノードとその子孫のメタデータを削除
		cleanupNodeMetadata: (nodeId) => {
			const projectId = get(selected_id);
			if (!projectId) return;

			const node = getNode(nodeId, get(tree_data).data);
			if (!node) return;

			// ノードとその子孫のIDをすべて収集
			const nodeIds = collectNodeAndDescendantIds(node);

			update(currentState => {
				const newState = new Set(currentState);

				// 収集したIDをすべて削除
				nodeIds.forEach(id => {
					newState.delete(id);
				});

				// 状態をマップに保存
				projectExpandedStates.set(projectId, newState);

				// メタデータに保存
				const metaKey = `closed_nodes_${projectId}`;
				const idsArray = Array.from(newState);
				console.log(`ノード削除による状態更新: ${metaKey}`, idsArray);
				window.electronAPI.setMetaData(metaKey, idsArray);

				return newState;
			});
		}
	};
}

project_ids = createProjectIds(undefined);
selected_type = writable(undefined);
table_selected_id = writable(undefined);
closed_node_ids = createClosedNodeIds(new Set()); // 閉じているノードのIDのセット
selected_id = createSelectedID(undefined);
theme = createTheme(undefined);
filter = createFilter({})
filtered_data = writable(tree_data.data)

// 画面内検索ボックスの表示状態
export const showPageSearch = writable(false);

// 古い変数名は使用しない

export function init_store() {
	// Get initial data of a project from db.
	tree_data.init();
	project_ids.init();
	selected_id.init();
	filter.init();
	// Set theme and other UI states
	theme.init();
	closed_node_ids.init();
}
