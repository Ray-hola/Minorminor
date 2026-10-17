import path from 'node:path';

// A VM's writable disk must not inherit a surrounding cache classification.
export function storagePurpose(filename) {
  const vm = /(?:^|\/)(?:vm[-_]bundles?|vm[-_]instances|[^/]+\.vmwarevm|[^/]+\.pvm)(?:\/|$)/i.test(filename);
  const name = path.basename(filename);
  if (!vm && !/\.(?:qcow2?|vmdk|vdi|vhdx?|hdd)$/i.test(name)) return null;
  if (/\.(?:img|iso)(?:\.(?:zst|gz|xz))$/i.test(name)) return { type: 'virtual-machine', format: '压缩虚拟机镜像', purpose: '虚拟机的压缩系统 / 安装镜像；删除后可能需要重新下载或重建环境' };
  if (/\.(?:img|qcow2?|vmdk|vdi|vhdx?|hdd)$/i.test(name)) return { type: 'virtual-machine', format: '虚拟磁盘', purpose: '虚拟机磁盘，可能保存系统、安装依赖及工作文件；保留，由所属应用管理' };
  if (/\.(?:iso|fd)$/i.test(name) || /^(?:vmlinuz|initrd)(?:[.-]|$)/i.test(name)) return { type: 'virtual-machine', format: '虚拟机启动资源', purpose: '虚拟机的启动盘、内核或固件；保留，由所属应用管理' };
  return { type: 'virtual-machine', format: '虚拟机资源', purpose: '应用的虚拟机运行环境，包含系统镜像和实例磁盘，可能保存工作数据；保留，由所属应用管理' };
}
