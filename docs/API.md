# Tài liệu API

Base URL: `http://localhost:5080` (Docker: cùng origin với web qua `/api`). Swagger UI: `/swagger`, OpenAPI JSON: `/openapi.json` (nguồn: `backend/openapi.yaml`).

- JSON dùng camelCase; enum là chuỗi: `kind` = `document` | `presentation`, `sort` = `name` | `newest` | `popular`.
- Thời gian là UTC theo ISO 8601. `traceId` trùng với header `X-Request-Id` và log của server.
- Lỗi trả về `application/problem+json` (RFC 7807):

```json
{
  "type": "https://httpstatuses.io/400",
  "title": "Dữ liệu không hợp lệ.",
  "status": 400,
  "detail": "Trường không tồn tại trong template.",
  "errors": { "fields.KhongCo": ["Trường không tồn tại trong template."] },
  "traceId": "3f6c…"
}
```

| Mã | Khi nào |
|---|---|
| 400 | Dữ liệu sai (tiêu đề rỗng/quá dài, trường lạ, file không hợp lệ, tham số sai kiểu) |
| 401 / 403 | Thiếu hoặc sai `X-Admin-Key`, token editor không hợp lệ |
| 404 | Template, preview hoặc tài liệu không tồn tại; ID không đúng định dạng UUID |
| 413 | File tải lên vượt dung lượng |
| 429 | Vượt giới hạn 60 thao tác ghi/phút/IP |
| 500 | Lỗi hệ thống (chi tiết chỉ có trong log) |

---

## Danh mục

### `GET /api/categories?type=document`

Danh mục có ít nhất một template đang hoạt động.

```json
[{ "slug": "nhan-su", "name": "Nhân sự", "kind": "document", "templateCount": 2 }]
```

## Template

### `GET /api/templates`

| Tham số | Mặc định | Mô tả |
|---|---|---|
| `type` | (tất cả) | `document` hoặc `presentation` |
| `q` | | Từ khóa, không phân biệt hoa thường và dấu; mọi từ đều phải khớp |
| `category` | | Slug danh mục |
| `sort` | `name` | `name`, `newest`, `popular` |
| `page`, `pageSize` | 1, 24 | `pageSize` tối đa 100 |

```json
{
  "items": [{
    "id": "8c0e…", "slug": "hop-dong-lao-dong", "kind": "document",
    "name": "Hợp đồng lao động", "description": "…",
    "category": { "slug": "nhan-su", "name": "Nhân sự" },
    "tags": ["hợp đồng", "nhân sự"],
    "thumbnailUrl": "/api/templates/8c0e…/previews/1?v=1",
    "pageCount": 2, "version": 1, "usageCount": 5,
    "updatedAt": "2026-10-29T14:00:00Z"
  }],
  "page": 1, "pageSize": 24, "totalCount": 6, "totalPages": 1
}
```

### `GET /api/templates/{id}`

Như trên, thêm `fileSize`, `fileExtension`, `previews[{pageNumber, imageUrl}]` và `fields[{key, label, defaultValue}]`.

### `GET /api/templates/{id}/previews/{page}`

Ảnh PNG của trang/slide (bắt đầu từ 1). Có `ETag` và `Cache-Control: public, max-age=86400`. 404 nếu trang không tồn tại.

### `POST /api/templates/{id}/documents`

Tạo tài liệu mới là bản sao độc lập của template.

```json
{ "title": "HĐLĐ - Trần Văn Lập", "fields": { "TenNguoiLaoDong": "Trần Văn Lập", "MucLuong": "30.000.000" } }
```

- `title` tùy chọn (mặc định là tên template), tối đa 200 ký tự.
- `fields` tùy chọn; key phải có trong template. Trường bỏ trống dùng `defaultValue`, nếu không có thì giữ placeholder.

Phản hồi `201 Created` + `Location: /api/documents/{id}` + `DocumentDto`.

### `POST /api/templates` (quản trị)

`multipart/form-data`, header `X-Admin-Key`. Trường: `file` (.docx/.pptx, ≤ 30 MB), `name` (bắt buộc), `slug`, `description`, `categorySlug`, `categoryName`, `tags` (phân tách bởi dấu phẩy). Cùng slug: cập nhật file và tăng `version`. Phản hồi `201` + `TemplateDetailDto`.

### `POST /api/admin/templates/sync` (quản trị)

Đồng bộ lại kho thư mục vào CSDL.

```json
{ "added": 0, "updated": 1, "unchanged": 9, "deactivated": 0, "errors": [] }
```

## Tài liệu

`DocumentDto`:

```json
{
  "id": "5f1d…", "title": "HĐLĐ - Trần Văn Lập", "kind": "document",
  "templateId": "8c0e…", "templateName": "Hợp đồng lao động", "templateVersion": 1,
  "version": 1, "fileSize": 38211, "fileExtension": ".docx",
  "thumbnailUrl": "/api/templates/8c0e…/previews/1?v=1",
  "createdAt": "…", "updatedAt": "…"
}
```

| Method | Đường dẫn | Mô tả |
|---|---|---|
| GET | `/api/documents?type=&page=&pageSize=` | Danh sách, mới sửa trước |
| GET | `/api/documents/{id}` | Chi tiết |
| PATCH | `/api/documents/{id}` | Đổi tên: `{ "title": "…" }` |
| DELETE | `/api/documents/{id}` | Xóa bản ghi và file, trả 204 |
| GET | `/api/documents/{id}/download` | Tải file DOCX/PPTX (`Content-Disposition` có tên tiếng Việt) |
| PUT | `/api/documents/{id}/content` | `multipart/form-data` trường `file`: lưu bản đã sửa bên ngoài, `version` + 1 |
| GET | `/api/documents/{id}/editor-config` | Config ONLYOFFICE đã ký: `{ enabled, documentServerUrl, config }` hoặc `{ enabled: false, message }` |

### Endpoint dành cho ONLYOFFICE Document Server (ẩn khỏi Swagger)

| Method | Đường dẫn | Bảo vệ |
|---|---|---|
| GET | `/api/documents/{id}/editor-content?token=` | Token HS256 `{purpose:"file", doc, exp}` |
| POST | `/api/documents/{id}/editor-callback` | JWT của Document Server (trong body hoặc header `Authorization`); luôn trả `{ "error": 0 }` hoặc `{ "error": 1 }` |

Callback status `2` (sẵn sàng lưu) và `6` (force save): API tải file từ `url` (chỉ chấp nhận host Document Server đã cấu hình), kiểm tra định dạng, ghi đè file tài liệu và tăng `version`. Các status khác chỉ xác nhận.

## Định dạng `meta.json` của template

```json
{
  "slug": "hop-dong-lao-dong",
  "type": "document",
  "name": "Hợp đồng lao động",
  "description": "…",
  "category": { "slug": "nhan-su", "name": "Nhân sự" },
  "tags": ["hợp đồng", "nhân sự"],
  "fields": [{ "key": "TenCongTy", "label": "Tên công ty", "defaultValue": "Công ty TNHH …" }]
}
```

`slug` phải trùng tên thư mục. Placeholder có trong file mà không khai báo trong `fields` vẫn được nhận, dùng key làm nhãn.
