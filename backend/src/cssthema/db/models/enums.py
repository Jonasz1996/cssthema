"""PostgreSQL-enums (zie docs/03-database-ontwerp.md § 3)."""

import enum


class UserRole(enum.StrEnum):
    ADMIN = "admin"
    EDITOR = "editor"
    VIEWER = "viewer"


class ServiceType(enum.StrEnum):
    GENERIC = "generic"
    PROXMOX = "proxmox"
    NEXTCLOUD = "nextcloud"
    IMMICH = "immich"
    HOME_ASSISTANT = "home_assistant"
    GRAFANA = "grafana"
    UNIFI = "unifi"
    JELLYFIN = "jellyfin"
    AUTHENTIK = "authentik"
    UPTIME_KUMA = "uptime_kuma"
    PORTAINER = "portainer"


class ServiceSource(enum.StrEnum):
    MANUAL = "manual"
    NPM = "npm"
    URL_LIST = "url_list"
    IMPORT = "import"


class PageKind(enum.StrEnum):
    HOME = "home"
    LOGIN = "login"
    CUSTOM = "custom"


class SnapshotOrigin(enum.StrEnum):
    CRAWLER = "crawler"
    URL_IMPORT = "url_import"
    UPLOAD = "upload"


class SelectorKind(enum.StrEnum):
    CLASS = "class"
    ID = "id"
    CSS_VARIABLE = "css_variable"
    ELEMENT = "element"
    ATTRIBUTE = "attribute"


class ThemeStatus(enum.StrEnum):
    DRAFT = "draft"
    PUBLISHED = "published"
    ARCHIVED = "archived"


class VersionSource(enum.StrEnum):
    MANUAL = "manual"
    ROLLBACK = "rollback"
    IMPORT = "import"
    DUPLICATE = "duplicate"
    AI = "ai"


class JobType(enum.StrEnum):
    SNAPSHOT_CAPTURE = "snapshot_capture"
    SNAPSHOT_ANALYZE = "snapshot_analyze"
    SCREENSHOT_CAPTURE = "screenshot_capture"
    DISCOVERY_NPM = "discovery_npm"
    DISCOVERY_URLS = "discovery_urls"
    AI_GENERATE = "ai_generate"
    THEME_HEALTH_CHECK = "theme_health_check"
    EXPORT_BUNDLE = "export_bundle"
    MAINTENANCE = "maintenance"


class JobStatus(enum.StrEnum):
    QUEUED = "queued"
    RUNNING = "running"
    SUCCEEDED = "succeeded"
    FAILED = "failed"
    CANCELLED = "cancelled"
