from abc import ABC, abstractmethod
from pathlib import Path


class FileStorageProvider(ABC):
    @abstractmethod
    def read(self, relative_path: str) -> bytes: ...

    @abstractmethod
    def write(self, relative_path: str, data: bytes) -> None: ...

    @abstractmethod
    def exists(self, relative_path: str) -> bool: ...

    @abstractmethod
    def list_files(self, relative_dir: str) -> list[str]: ...

    @abstractmethod
    def delete(self, relative_path: str) -> None: ...

    @abstractmethod
    def get_absolute_path(self, relative_path: str) -> Path: ...


class LocalFileStorageProvider(FileStorageProvider):
    def __init__(self, base_path: str) -> None:
        self._base = Path(base_path)

    def get_absolute_path(self, relative_path: str) -> Path:
        return self._base / relative_path

    def exists(self, relative_path: str) -> bool:
        return self.get_absolute_path(relative_path).exists()

    def read(self, relative_path: str) -> bytes:
        return self.get_absolute_path(relative_path).read_bytes()

    def write(self, relative_path: str, data: bytes) -> None:
        abs_path = self.get_absolute_path(relative_path)
        abs_path.parent.mkdir(parents=True, exist_ok=True)
        abs_path.write_bytes(data)

    def list_files(self, relative_dir: str) -> list[str]:
        abs_dir = self.get_absolute_path(relative_dir)
        if not abs_dir.exists():
            return []
        return [str(p.relative_to(self._base)) for p in abs_dir.iterdir() if p.is_file()]

    def delete(self, relative_path: str) -> None:
        self.get_absolute_path(relative_path).unlink(missing_ok=True)
