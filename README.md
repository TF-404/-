# 臺灣縣市抽獎

靜態網頁，由 GitHub Pages 從 `main` 分支根目錄提供：<https://tf-404.github.io/-/>

地圖畫出臺灣二十二個縣市。按下「抽獎」後，白色光框會在縣市之間隨機跳動，先快後慢，約五秒後停在以 `crypto.getRandomValues` 均等抽出的縣市。

- 「不重複抽」會排除這一輪已經抽過的縣市
- 「重設」清除紀錄與標示

## 資料

縣市界線來自內政部「直轄市、縣市界線（TWD97 經緯度）」，使用 [taiwan-atlas](https://github.com/dkaoster/taiwan-atlas) 2021.9.20 的 `counties-10t.json`（未改檔，MIT）。繪圖程式為同目錄內的 d3 7.9.0 與 topojson-client 3.1.0，頁面不連外部 CDN。

澎湖縣、金門縣、連江縣（馬祖）放在側邊小圖，金門縣的烏坵鄉畫在金門小圖內。地名依通用繁體寫作「臺」。
