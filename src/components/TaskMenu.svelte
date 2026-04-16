<script>
    import { createEventDispatcher, onDestroy } from "svelte";

    // メニュー項目の型定義
    export let menuItems = [];

    // 位置情報
    export let position = { x: 0, y: 0, position: "right" };
    export let show = false;
    // タスク名
    export let taskText = "";

    const dispatch = createEventDispatcher();

    // メニュー要素の参照
    let menuElement;

    // メニューの作成・削除
    $: if (show) {
        createMenu();
    } else {
        removeMenu();
    }

    // コンポーネント破棄時の処理
    onDestroy(() => {
        removeMenu();
    });

    // 画面外クリックでメニューを閉じる
    function handleClickOutside(event) {
        if (show && menuElement && !menuElement.contains(event.target)) {
            dispatch("close");
        }
    }

    // メニュー作成
    function createMenu() {
        removeMenu(); // 既存のメニューを削除

        // メニュー要素の作成
        menuElement = document.createElement("div");
        menuElement.id = "task-menu";
        menuElement.style.position = "fixed";
        menuElement.style.zIndex = "999999999999";
        menuElement.style.top = `${position.y}px`;

        if (position.position === "left") {
            menuElement.style.right = `calc(100% - ${position.x}px)`;
        } else {
            menuElement.style.left = `${position.x}px`;
        }

        // メニュー内容のHTMLを構築
        const menuHTML = `
            <ul class="task-menu" style="
                background: var(--theme-color-Main-main);
                border-radius: 0.5rem;
                box-shadow: 0 0.2rem 0.5rem rgba(0, 0, 0, 0.25), 0 0.1em 0.25rem rgba(0, 0, 0, 0);
                white-space: nowrap;
                margin: 0;
                padding: 4px 0;
                list-style: none;
                min-width: fit-content;
                display: flex;
                flex-direction: column;
                overflow: hidden;
            ">
                ${menuItems
                    .map(
                        (item, index) => `
                    <li style="
                        margin: 0;
                        padding: 0;
                        width: 100%;
                        display: block;
                    ">
                        <button id="task-menu-item-${index}" style="
                            width: 100%;
                            text-align: left;
                            padding: 6px 10px;
                            display: flex;
                            align-items: center;
                            border-radius: 0;
                            color: var(--theme-color-Sub-light);
                            font-size: 0.85rem;
                            height: auto;
                            aspect-ratio: auto;
                            margin: 0;
                            background: transparent;
                            border: none;
                            cursor: pointer;
                        ">
                            ${
                                item.icon
                                    ? `
                                <svg
                                    viewBox="${item.icon.viewBox}"
                                    xmlns="http://www.w3.org/2000/svg"
                                    style="
                                        margin-right: 6px;
                                        width: 14px;
                                        height: 14px;
                                        flex-shrink: 0;
                                        fill: var(--theme-color-Sub-light);
                                    "
                                >
                                    <path d="${item.icon.path}"></path>
                                </svg>
                            `
                                    : ""
                            }
                            <span style="flex: 0 1 auto;">${item.title}</span>
                        </button>
                    </li>
                `,
                    )
                    .join("")}
            </ul>
        `;

        menuElement.innerHTML = menuHTML;

        // body直下に追加
        document.body.appendChild(menuElement);

        // イベントリスナーを追加
        menuItems.forEach((item, index) => {
            const button = document.getElementById(`task-menu-item-${index}`);
            if (button) {
                // クリックイベントリスナー（バブリングを防止）
                button.addEventListener("click", function (e) {
                    // イベントのデフォルト動作とバブリングを防止
                    e.preventDefault();
                    e.stopPropagation();

                    try {
                        dispatch(item.action, {
                            action: item.action,
                            text: taskText,
                        });
                        dispatch("close");

                        // メニューを閉じる
                        removeMenu();
                    } catch (error) {
                        console.error("Error in menu click handler:", error);
                    }
                });

                // ホバー効果
                button.addEventListener("mouseover", () => {
                    button.style.backgroundColor =
                        "var(--theme-color-Accent-dark)";
                });
                button.addEventListener("mouseout", () => {
                    button.style.backgroundColor = "transparent";
                });
            }
        });
    }

    // メニュー削除
    function removeMenu() {
        if (menuElement) {
            menuElement.remove();
            menuElement = null;
        }

        const existingMenu = document.getElementById("task-menu");
        if (existingMenu) {
            existingMenu.remove();
        }
    }
</script>

<svelte:window on:click={handleClickOutside} />
