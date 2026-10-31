# Thư viện mẫu tài liệu văn phòng

Bài kiểm tra thực hành vị trí **Fullstack Developer**: hai sản phẩm chạy được thực tế trên cùng một nền tảng.

| Sản phẩm | Đường dẫn | Định dạng |
|---|---|---|
| 1. Thư viện mẫu văn bản | `/van-ban` | DOCX |
| 2. Thư viện mẫu trình chiếu | `/trinh-chieu` | PPTX |

Người dùng tìm kiếm, lọc theo danh mục, xem trước từng trang/slide, điền sẵn thông tin (tùy chọn) rồi tạo tài liệu mới. Tài liệu mới là **bản sao độc lập** của mẫu. Sau đó có thể chỉnh sửa trong trình soạn thảo tích hợp (ONLYOFFICE), hoặc tải về sửa bằng Word/PowerPoint rồi tải lên lại. File template gốc không bao giờ bị thay đổi.

| Thư viện văn bản | Xem trước bộ slide |
|---|---|
| ![Thư viện văn bản](docs/screenshots/thu-vien-van-ban.png) | ![Xem trước trình chiếu](docs/screenshots/xem-truoc-trinh-chieu.png) |
| **Tạo văn bản, điền trước thông tin** | **Tài liệu của tôi** |
| ![Tạo văn bản](docs/screenshots/tao-van-ban.png) | ![Tài liệu của tôi](docs/screenshots/tai-lieu-cua-toi.png) |

**Công nghệ:** React 19 + TypeScript (frontend), Node.js 22 + Express 5 + TypeScript (backend), PostgreSQL 17 + Prisma 7 (CSDL), ONLYOFFICE Document Server (trình soạn thảo).

---

## 1. Chạy thử

### Cách 1: Docker (khuyến nghị, chạy đủ mọi thành phần)

Yêu cầu: Docker Desktop, khoảng 4 GB RAM trống (ONLYOFFICE khá nặng).

```bash
cp .env.example .env
docker compose up --build
```

| Thành phần | URL |
|---|---|
| Ứng dụng web | http://localhost:3000 |
| API + Swagger UI | http://localhost:5080/swagger |
| ONLYOFFICE Document Server | http://localhost:8081 |

Khi khởi động, container API tự chạy `prisma migrate deploy` rồi đồng bộ kho `templates/` vào CSDL. Lần đầu ONLYOFFICE cần 1–2 phút để sẵn sàng; trong lúc đó trang tài liệu tự chuyển sang luồng tải về/tải lên.

> Upload template qua API cần thư mục `templates/` trên máy cho phép container ghi (`chmod -R a+w templates` trên Linux/macOS).

### Cách 2: Chạy từng phần để phát triển

Yêu cầu: Node.js 20.19+ (khuyến nghị 22), PostgreSQL 14+.

```bash
# PostgreSQL (nếu chưa có) – tạo sẵn cả CSDL test
docker compose up -d postgres

# Backend – http://localhost:5080/swagger
cd backend
cp .env.example .env
npm install                 # postinstall chạy `prisma generate`
npx prisma migrate deploy   # tạo bảng
npm run dev

# Frontend – http://localhost:5173 (Vite proxy /api -> :5080)
cd frontend
npm install
npm run dev
```

Khi chạy kiểu này, trình soạn thảo trực tuyến tắt mặc định (`ONLYOFFICE_ENABLED=false`). Luồng tạo tài liệu, tải xuống và tải lên bản đã sửa vẫn hoạt động đầy đủ. Ảnh xem trước cho template mới cần LibreOffice và poppler trên máy; nếu không có thì đặt `PREVIEWS_ENABLED=false` (template mẫu đã có sẵn ảnh).

### Chạy test

```bash
cd backend && npm test     # 48 test: unit + integration (Express thật + PostgreSQL thật)
cd frontend && npm test    # 10 test: Vitest + Testing Library
```

Test backend dùng CSDL riêng `office_templates_test` (mặc định `postgresql://postgres:postgres@localhost:5432/office_templates_test`, đổi bằng `TEST_DATABASE_URL`). Mỗi lần chạy, schema được xóa và tạo lại từ file migration.

---

## 2. Kiến trúc

```
office-template-library/
├── backend/                      Node.js + Express 5 + TypeScript
│   ├── prisma/                   schema.prisma + migrations (PostgreSQL)
│   ├── src/
│   │   ├── domain/               Loại tài liệu + registry định dạng, chuẩn hóa tìm kiếm, slug
│   │   ├── services/             Nghiệp vụ: tìm kiếm template, tạo/lưu tài liệu, DTO
│   │   ├── catalog/              Đồng bộ kho template (meta.json), upload, versioning
│   │   ├── ooxml/                Đọc/thay placeholder trong DOCX/PPTX (JSZip + xmldom)
│   │   ├── previews/             Sinh ảnh xem trước bằng LibreOffice + pdftoppm
│   │   ├── editor/               Tích hợp ONLYOFFICE (JWT, callback)
│   │   ├── storage/              FileStorage (ổ đĩa local)
│   │   ├── routes/, middleware/  Express router, ProblemDetails, xác thực admin, upload
│   │   ├── app.ts                Composition root: tạo service, gắn router
│   │   └── server.ts             Khởi động: chờ DB, đồng bộ kho, listen, graceful shutdown
│   ├── openapi.yaml              Đặc tả API (Swagger UI tại /swagger)
│   └── test/                     Vitest + Supertest
├── frontend/                     React 19 + TypeScript + Vite, TanStack Query, React Router
├── templates/                    Kho template mẫu (6 DOCX + 4 PPTX, meta.json, ảnh preview)
├── docs/                         Tài liệu API và ảnh chụp màn hình
└── docker-compose.yml            postgres + onlyoffice + api + web
```

```
 Trình duyệt ──► nginx (web) ──/api──► Express API ──► PostgreSQL (metadata, qua Prisma)
     │                                   │      │
     │                                   │      └──► Kho file: templates/ (chỉ đọc khi tạo tài liệu)
     │                                   │                     documents/ (bản sao của người dùng)
     └──── iframe editor ──► ONLYOFFICE ─┘  tải file bằng URL có token, callback lưu có JWT
```

### Công nghệ

| Tầng | Lựa chọn | Lý do |
|---|---|---|
| Frontend | React 19, TypeScript, Vite, TanStack Query, React Router | Cache, trạng thái loading/lỗi có sẵn; trạng thái tìm kiếm nằm trên URL |
| Backend | Node.js 22, Express 5, TypeScript, Zod, Pino | Express 5 tự bắt lỗi của handler async; Zod kiểm tra input; log JSON có request id |
| CSDL | PostgreSQL 17 + Prisma 7 (driver adapter `@prisma/adapter-pg`) | Schema khai báo, migration có version, client có kiểu; Prisma 7 không cần query engine nhị phân |
| Xử lý DOCX/PPTX | JSZip + @xmldom/xmldom | Sửa trực tiếp XML Open XML nên giữ nguyên định dạng; không phụ thuộc thư viện template trả phí |
| Trình soạn thảo | ONLYOFFICE Document Server (Docker) | Sửa được cả DOCX và PPTX trong trình duyệt, độ tương thích cao |
| Ảnh xem trước | LibreOffice headless → PDF → `pdftoppm` → PNG | Render đúng bố cục thật của từng trang/slide |

### Một nền tảng cho nhiều loại tài liệu

Hai sản phẩm dùng chung toàn bộ backend và component frontend, chỉ khác giá trị `DocumentKind`:

- Backend: `src/domain/documentKinds.ts` ánh xạ loại tài liệu sang phần mở rộng, MIME type, loại editor và thư mục kho.
- Frontend: `src/kinds.ts` cấu hình đường dẫn, nhãn, tỉ lệ khung xem trước (A4 dọc hoặc 16:9).

Thêm một loại tài liệu là thêm một giá trị `DocumentKind` cùng một mục cấu hình ở hai file trên.

---

## 3. Mô hình dữ liệu (Prisma, `backend/prisma/schema.prisma`)

```
Category        (id, slug, name, kind)                            unique(kind, slug)
Template        (id uuid, slug, kind, name, description, categoryId, tags text[], searchText,
                 filePath, fileSha256, fileSize, version, usageCount, isActive,
                 createdAt, updatedAt)                            unique(slug), index(kind, isActive)
TemplatePreview (id, templateId, pageNumber, imagePath)           unique(templateId, pageNumber)
TemplateField   (id, templateId, key, label, defaultValue, sortOrder)  unique(templateId, key)
Document        (id uuid, templateId?, templateVersion, kind, title, filePath, fileSize,
                 version, createdAt, updatedAt)                   FK template ON DELETE SET NULL
```

- `searchText`: tên + mô tả + danh mục + tag đã bỏ dấu và chuyển chữ thường, nên gõ “hop dong” vẫn tìm được “Hợp đồng”.
- `fileSha256` / `version`: khi file template thay đổi, hash đổi thì version tăng. Mỗi tài liệu ghi lại `templateVersion` mà nó được tạo từ đó.
- `Document.version`: tăng mỗi lần lưu, đồng thời làm document key cho ONLYOFFICE.
- Xóa template không xóa tài liệu đã tạo (`SET NULL`); xóa template thì preview và field của nó bị xóa theo (`CASCADE`).
- Migration: `prisma/migrations/20261030000000_init`. Khi đổi schema, chạy `npm run db:migrate:dev -- --name <ten>`.

Chi tiết endpoint: [docs/API.md](docs/API.md). Đặc tả OpenAPI: `backend/openapi.yaml`, Swagger UI ở `/swagger`.

---

## 4. Lưu trữ, quản lý và phân phối template

Mỗi template là một thư mục, tự mô tả bằng `meta.json`:

```
templates/documents/hop-dong-lao-dong/
├── template.docx
├── meta.json         slug, type, name, description, category, tags, fields[{key,label,defaultValue}]
└── previews/page-1.png, page-2.png …
```

Có ba cách thêm hoặc cập nhật template, **không phải sửa code giao diện** trong cả ba cách:

1. Thả thư mục mới vào `templates/` rồi gọi `POST /api/admin/templates/sync` (hoặc khởi động lại API).
2. Upload file qua `POST /api/templates` (header `X-Admin-Key`): API tự đặt slug, dò placeholder `{{...}}`, ghi `meta.json` và sinh ảnh preview bằng LibreOffice.
3. Upload lại cùng slug để cập nhật: version tăng, ảnh preview sinh lại, tài liệu đã tạo trước đó không bị ảnh hưởng.

Quy trình đồng bộ kiểm tra `meta.json` bằng Zod, kiểm tra file là gói Open XML hợp lệ đúng loại, so sánh SHA-256, tự phát hiện placeholder có trong file, và ẩn (không xóa) template đã bị gỡ khỏi kho.

**Phân phối:** ảnh preview phục vụ qua `/api/templates/{id}/previews/{page}?v={version}`, có `ETag`, `Last-Modified`, trả 304 khi không đổi, và `Cache-Control: max-age=86400`. URL đổi khi template lên version mới nên không bị cache cũ. Client không bao giờ nhận đường dẫn file thật.

**Placeholder:** template chứa `{{TenTruong}}`. Khi tạo tài liệu, người dùng có thể điền trước. Ô để trống dùng giá trị mặc định; nếu không có mặc định thì giữ nguyên placeholder để sửa sau trong editor.

---

## 5. Tạo bản sao mà không sửa file gốc

`DocumentService.createFromTemplate` (`backend/src/services/documentService.ts`):

1. **Đọc** file template vào bộ nhớ (`fs.readFile`). File gốc không bao giờ được mở để ghi.
2. Thay placeholder trên bản trong bộ nhớ (`PlaceholderEngine.apply` trả về buffer **mới**). Engine sửa trực tiếp các phần tử `w:t` (Word) / `a:t` (PowerPoint), nên style, bảng, header/footer, đánh số, khổ giấy được giữ nguyên. Placeholder bị Word tách thành nhiều run (ví dụ `{{Ten` + `KhachHang}}`) vẫn được xử lý; giá trị nằm vào run đầu tiên nên giữ định dạng của run đó.
3. Ghi file mới vào `documents/yyyy/MM/{uuid}.docx` theo kiểu nguyên tử (ghi file tạm rồi `rename`).
4. Tạo bản ghi `Document` và tăng `usageCount` trong một transaction. Nếu ghi CSDL lỗi thì xóa file vừa tạo để không để lại file mồ côi.

Mọi thao tác sửa, lưu, tải lên sau đó chỉ trỏ tới file trong `documents/`. Các test chứng minh điều này:

- `tạo bản sao đã điền trường mà không thay đổi file template`: so SHA-256 của template trước và sau.
- `giữ nguyên định dạng cơ bản của DOCX`: so số đoạn, bảng, dòng bảng, run in đậm, danh sách, nguyên XML styles và section (khổ giấy, lề).
- `các tài liệu tạo từ cùng một mẫu độc lập với nhau`: sửa bản A thì bản B không đổi.

---

## 6. Trình soạn thảo

**ONLYOFFICE (khi chạy Docker).** Trang tài liệu gọi `GET /api/documents/{id}/editor-config` để lấy config đã ký JWT, rồi nhúng `DocsAPI.DocEditor`:

- Document Server tải file qua `GET /api/documents/{id}/editor-content?token=…`. Token HMAC gắn với đúng tài liệu và hết hạn sau 30 phút.
- Khi người dùng lưu hoặc đóng, Document Server gọi `POST /api/documents/{id}/editor-callback`. API xác thực JWT (trong body hoặc header `Authorization`), chỉ tin dữ liệu bên trong token, kiểm tra document key, chỉ tải file kết quả từ đúng host Document Server (chống SSRF), rồi lưu thành phiên bản mới.

**Khi không có editor trực tuyến:** trang tài liệu hướng dẫn tải file về, sửa bằng Word/PowerPoint/LibreOffice và tải lên lại (`PUT /api/documents/{id}/content`). File tải lên được kiểm tra đúng định dạng Open XML và đúng loại tài liệu trước khi lưu. Đây cũng là phương án dự phòng tự động khi không kết nối được Document Server.

---

## 7. Xử lý lỗi, bảo mật, kiểm thử

**Xử lý lỗi**

- Backend: mọi lỗi trả về `application/problem+json` (RFC 7807) có `traceId`, trùng với header `X-Request-Id` và log.
  - Lỗi dữ liệu (Zod hoặc nghiệp vụ) trả 400 kèm danh sách lỗi theo trường.
  - ID không phải UUID hoặc không tồn tại trả 404.
  - File quá lớn trả 413; vượt giới hạn tần suất trả 429.
  - Lỗi hệ thống trả 500 với thông báo chung; chi tiết chỉ ghi log.
- Frontend: mỗi màn hình có đủ ba trạng thái loading (skeleton), lỗi (kèm nút thử lại) và rỗng (kèm hành động gợi ý). Không tìm thấy mẫu/tài liệu có màn hình riêng. Lỗi 4xx không tự thử lại.

**Bảo mật**

- Chặn path traversal: client chỉ dùng ID; `LocalFileStorage.resolve` chuẩn hóa đường dẫn và bắt buộc nằm trong thư mục gốc.
- Kiểm tra file upload: phần mở rộng, giới hạn dung lượng (multer: 30 MB template, 50 MB tài liệu), mở thử gói Open XML.
- Giá trị điền vào placeholder được XML-escape và loại ký tự điều khiển.
- ONLYOFFICE: JWT HS256 hai chiều (so sánh chữ ký thời gian hằng, chặn `alg: none`), token tải file riêng có hạn dùng, whitelist host khi tải file kết quả.
- API quản trị bảo vệ bằng `X-Admin-Key` (so sánh thời gian hằng). Rate limit 60 thao tác ghi/phút/IP. Helmet đặt các header bảo mật. Container API chạy bằng user `node`, không phải root.

**Kiểm thử (48 test backend, 10 test frontend)**

- Backend (Vitest + Supertest, chạy với PostgreSQL thật):
  - Placeholder engine: run bị tách, giữ định dạng, bảng, escape XML, PPTX, không sửa input, kiểm tra loại gói.
  - API template: lọc, tìm không dấu, phân trang, validation, preview + ETag/304, 404.
  - Tạo tài liệu: template không đổi, giữ định dạng, độc lập giữa các bản sao, validation, file sai loại.
  - Upload/đồng bộ template, tăng version, ẩn template bị gỡ.
  - ONLYOFFICE: ký config, token file, callback hợp lệ/sai token/sai key/URL lạ/header.
  - JWT, slug, chuẩn hóa tìm kiếm, path traversal, cấu hình.
- Frontend (Vitest + Testing Library):
  - Danh sách; tìm kiếm/lọc đồng bộ URL; trạng thái rỗng/lỗi/thử lại.
  - Xem trước và tạo tài liệu; lỗi validation từ server.
  - Editor dự phòng (tải lên bản sửa); danh sách và xóa tài liệu.

---

## 8. Hoàn thành, chưa hoàn thành và giới hạn

**Đã hoàn thành**

- [x] Thư viện văn bản: lưới mẫu có ảnh xem trước, tên, mô tả, danh mục; tìm kiếm (không dấu), lọc danh mục, sắp xếp, phân trang
- [x] Cửa sổ xem trước có URL riêng: xem từng trang/slide, filmstrip
- [x] Tạo tài liệu mới từ mẫu, điền trước trường tùy chọn; file gốc không đổi (có test chứng minh)
- [x] Chỉnh sửa bằng ONLYOFFICE tích hợp (DOCX và PPTX), lưu qua callback có xác thực
- [x] Phương án tải xuống, sửa ngoài, tải lên phiên bản mới; tải xuống DOCX/PPTX
- [x] Thư viện trình chiếu: cùng các chức năng trên, xem trước toàn bộ slide
- [x] Tài liệu của tôi: lọc theo loại, mở, đổi tên, tải xuống, xóa
- [x] Quản lý template: kho thư mục + `meta.json`, đồng bộ, upload/cập nhật qua API, tự sinh preview, versioning
- [x] Dữ liệu mẫu: 6 template văn bản, 4 template trình chiếu tiếng Việt
- [x] Docker Compose một lệnh, OpenAPI/Swagger, test backend với PostgreSQL thật và test frontend

**Chưa làm (ngoài phạm vi 6–8 giờ)**

- [ ] Đăng nhập và phân quyền: hiện mọi người dùng chung một danh sách tài liệu. Hướng làm: thêm `ownerId` vào `Document`, xác thực OIDC/JWT, lọc theo người dùng.
- [ ] Giao diện quản trị template (hiện quản trị qua API/Swagger).
- [ ] Thumbnail riêng cho tài liệu sau khi chỉnh sửa (đang dùng thumbnail của mẫu gốc). Có thể sinh nền bằng hàng đợi (BullMQ) + LibreOffice.
- [ ] Lịch sử phiên bản tài liệu (hiện chỉ lưu bản mới nhất).
- [ ] Test E2E tự động bằng Playwright (luồng đã được chạy thử thủ công trên trình duyệt).

**Giới hạn kỹ thuật**

- Thay placeholder hỗ trợ: đoạn văn, bảng, header/footer, footnote/endnote (DOCX); text trong slide (PPTX). Chưa hỗ trợ: ghi chú slide, biểu đồ, SmartArt, text của slide layout/master. Giá trị nhiều dòng được gộp về một dòng.
- Ảnh preview là ảnh tĩnh do LibreOffice render, có thể lệch nhẹ về font so với Word/PowerPoint. Image Docker đã cài font Liberation (cùng metric với Times New Roman/Arial).
- Việc sinh preview khi upload chạy đồng bộ trong request (vài giây). Khi lượng upload lớn nên chuyển sang hàng đợi nền.
- Lưu file trên ổ đĩa local (volume Docker). Khi chạy nhiều instance cần thay `FileStorage` bằng S3/R2.
- ONLYOFFICE Community Edition (AGPLv3) giới hạn 20 kết nối chỉnh sửa đồng thời và cần khoảng 2 GB RAM.

---

## 9. Thư viện bên thứ ba và giấy phép

| Thư viện | Dùng cho | Giấy phép |
|---|---|---|
| Express 5, multer, helmet, express-rate-limit | HTTP server, upload, header bảo mật, rate limit | MIT |
| Prisma 7 (`prisma`, `@prisma/client`, `@prisma/adapter-pg`), `pg` | ORM, migration, driver PostgreSQL | Apache-2.0 / MIT |
| Zod | Kiểm tra dữ liệu vào, cấu hình | MIT |
| JSZip | Đọc/ghi gói Office (zip) | MIT (dual MIT/GPLv3, dùng theo MIT) |
| @xmldom/xmldom | Phân tích/ghi XML | MIT |
| Pino, pino-http | Log JSON | MIT |
| swagger-ui-express, yaml | Swagger UI, đọc OpenAPI | MIT / ISC |
| Vitest, Supertest | Test backend | MIT |
| React, React Router, TanStack Query, Vite | Frontend | MIT |
| Testing Library, jsdom | Test frontend | MIT |
| PostgreSQL | CSDL | PostgreSQL License |
| ONLYOFFICE Document Server (Docker image) | Trình soạn thảo DOCX/PPTX | AGPLv3; chạy như dịch vụ riêng, không nhúng mã nguồn |
| LibreOffice | Render ảnh xem trước | MPL-2.0; gọi như tiến trình ngoài |
| poppler-utils (`pdftoppm`) | PDF sang PNG | GPL-2.0; gọi như tiến trình ngoài |
| Be Vietnam Pro (Google Fonts) | Font giao diện | SIL OFL 1.1 |
