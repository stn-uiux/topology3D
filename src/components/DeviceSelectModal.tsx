import React, { useState, useMemo, useEffect, useRef } from 'react';
import { getRawData, groupsMetadata } from '../data';

interface DeviceInfo {
  deviceId: number;
  deviceName: string;
  deviceIpAddr: string;
  deviceGroupId: number;
}

interface DeviceSelectModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (device: DeviceInfo) => void;
  title: string;
}

const ITEMS_PER_PAGE = 10;

const DeviceSelectModal: React.FC<DeviceSelectModalProps> = ({ isOpen, onClose, onSelect, title }) => {
  const [searchName, setSearchName] = useState('');
  const [searchIp, setSearchIp] = useState('');
  const [selectedGroupId, setSelectedGroupId] = useState<number | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [expandedGroups, setExpandedGroups] = useState<Set<number>>(new Set());
  const modalRef = useRef<HTMLDivElement>(null);

  // 원본 데이터에서 장비 목록 추출
  const allDevices: DeviceInfo[] = useMemo(() => {
    const raw = getRawData();
    if (!raw) return [];
    return raw.nodes.map(n => ({
      deviceId: n.deviceId,
      deviceName: n.deviceName,
      deviceIpAddr: n.deviceIpAddr,
      deviceGroupId: n.deviceGroupId,
    }));
  }, [isOpen]);

  // 그룹 트리 데이터 구성
  const groupTree = useMemo(() => {
    const groups: { groupId: number; groupName: string; deviceCount: number }[] = [];
    const raw = getRawData();
    if (!raw) return groups;

    const groupDeviceCount = new Map<number, number>();
    for (const n of raw.nodes) {
      groupDeviceCount.set(n.deviceGroupId, (groupDeviceCount.get(n.deviceGroupId) || 0) + 1);
    }

    for (const g of raw.groups) {
      groups.push({
        groupId: g.groupId,
        groupName: g.groupName,
        deviceCount: groupDeviceCount.get(g.groupId) || 0,
      });
    }

    return groups.sort((a, b) => a.groupId - b.groupId);
  }, [isOpen]);

  // 필터링된 장비 목록
  const filteredDevices = useMemo(() => {
    let devices = allDevices;

    if (selectedGroupId !== null) {
      devices = devices.filter(d => d.deviceGroupId === selectedGroupId);
    }

    if (searchName.trim()) {
      const keyword = searchName.trim().toLowerCase();
      devices = devices.filter(d => d.deviceName.toLowerCase().includes(keyword));
    }

    if (searchIp.trim()) {
      const keyword = searchIp.trim();
      devices = devices.filter(d => d.deviceIpAddr.includes(keyword));
    }

    return devices;
  }, [allDevices, selectedGroupId, searchName, searchIp]);

  // 페이지네이션
  const totalPages = Math.max(1, Math.ceil(filteredDevices.length / ITEMS_PER_PAGE));
  const pagedDevices = useMemo(() => {
    const start = (currentPage - 1) * ITEMS_PER_PAGE;
    return filteredDevices.slice(start, start + ITEMS_PER_PAGE);
  }, [filteredDevices, currentPage]);

  // 필터 변경 시 페이지 리셋
  useEffect(() => {
    setCurrentPage(1);
  }, [selectedGroupId, searchName, searchIp]);

  // 모달 외부 클릭 닫기
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (modalRef.current && !modalRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen, onClose]);

  // ESC 닫기
  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    if (isOpen) {
      document.addEventListener('keydown', handleEsc);
    }
    return () => document.removeEventListener('keydown', handleEsc);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleSearch = () => {
    setCurrentPage(1);
  };

  const handleGroupClick = (groupId: number) => {
    if (selectedGroupId === groupId) {
      setSelectedGroupId(null);
    } else {
      setSelectedGroupId(groupId);
    }
  };

  // 페이지 번호 배열 생성
  const getPageNumbers = () => {
    const pages: (number | string)[] = [];
    if (totalPages <= 7) {
      for (let i = 1; i <= totalPages; i++) pages.push(i);
    } else {
      pages.push(1);
      if (currentPage > 3) pages.push('...');
      const start = Math.max(2, currentPage - 1);
      const end = Math.min(totalPages - 1, currentPage + 1);
      for (let i = start; i <= end; i++) pages.push(i);
      if (currentPage < totalPages - 2) pages.push('...');
      pages.push(totalPages);
    }
    return pages;
  };

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div
        ref={modalRef}
        className="bg-[#1a1d26] border border-[#2d3748] rounded-xl shadow-2xl w-[780px] max-h-[600px] flex flex-col overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-[#2d3748]">
          <h2 className="text-[15px] font-bold text-gray-200 tracking-wide">{title}</h2>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-300 transition-colors p-1"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="flex flex-1 min-h-0">
          {/* Left sidebar - Group tree */}
          <div className="w-[180px] border-r border-[#2d3748] flex flex-col">
            <div className="px-3 py-2 text-[11px] font-bold text-gray-500 uppercase tracking-wider border-b border-[#2d3748]/50">
              그룹
            </div>
            <div className="flex-1 overflow-y-auto py-1 custom-scrollbar">
              {/* All groups */}
              <button
                onClick={() => setSelectedGroupId(null)}
                className={`w-full text-left px-3 py-1.5 text-[12px] flex items-center transition-colors ${
                  selectedGroupId === null
                    ? 'bg-cyan-500/10 text-cyan-400 font-semibold'
                    : 'text-gray-400 hover:bg-[#232733] hover:text-gray-200'
                }`}
              >
                <svg className="w-3.5 h-3.5 mr-2 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="1.5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.75V12A2.25 2.25 0 0 1 4.5 9.75h15A2.25 2.25 0 0 1 21.75 12v.75m-8.69-6.44-2.12-2.12a1.5 1.5 0 0 0-1.061-.44H4.5A2.25 2.25 0 0 0 2.25 6v12a2.25 2.25 0 0 0 2.25 2.25h15A2.25 2.25 0 0 0 21.75 18V9a2.25 2.25 0 0 0-2.25-2.25h-5.379a1.5 1.5 0 0 1-1.06-.44Z" />
                </svg>
                전체
              </button>
              {groupTree.map(g => (
                <button
                  key={g.groupId}
                  onClick={() => handleGroupClick(g.groupId)}
                  className={`w-full text-left px-3 py-1.5 text-[12px] flex items-center justify-between transition-colors ${
                    selectedGroupId === g.groupId
                      ? 'bg-cyan-500/10 text-cyan-400 font-semibold'
                      : 'text-gray-400 hover:bg-[#232733] hover:text-gray-200'
                  }`}
                >
                  <span className="flex items-center truncate">
                    <svg className="w-3 h-3 mr-2 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="1.5">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5.25 14.25h13.5m-13.5 0a3 3 0 0 1-3-3m3 3a3 3 0 1 0 0 6h13.5a3 3 0 1 0 0-6m-16.5-3a3 3 0 0 1 3-3h13.5a3 3 0 0 1 3 3m-19.5 0a4.5 4.5 0 0 1 .9-2.7L5.737 5.1a3.375 3.375 0 0 1 2.7-1.35h7.126c1.062 0 2.062.5 2.7 1.35l2.587 3.45a4.5 4.5 0 0 1 .9 2.7m0 0a3 3 0 0 1-3 3m0 3h.008v.008h-.008v-.008Zm0-6h.008v.008h-.008v-.008Zm-3 6h.008v.008h-.008v-.008Zm0-6h.008v.008h-.008v-.008Z" />
                    </svg>
                    <span className="truncate">{g.groupName}</span>
                  </span>
                  <span className="text-[11px] text-gray-600 ml-1 shrink-0">{g.deviceCount}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Right content - Search and table */}
          <div className="flex-1 flex flex-col min-w-0">
            {/* Search bar */}
            <div className="flex items-center gap-2 px-4 py-2.5 border-b border-[#2d3748]/50">
              <div className="flex items-center gap-1.5">
                <span className="text-[11px] text-gray-500 shrink-0">장비명</span>
                <input
                  type="text"
                  value={searchName}
                  onChange={e => setSearchName(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleSearch()}
                  placeholder=""
                  className="bg-[#0d0f14] border border-[#2d3748] rounded px-2 py-1 text-[12px] text-gray-200 w-[120px] focus:outline-none focus:border-cyan-600 transition-colors"
                />
              </div>
              <div className="flex items-center gap-1.5">
                <span className="text-[11px] text-gray-500 shrink-0">IP주소</span>
                <input
                  type="text"
                  value={searchIp}
                  onChange={e => setSearchIp(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleSearch()}
                  placeholder=""
                  className="bg-[#0d0f14] border border-[#2d3748] rounded px-2 py-1 text-[12px] text-gray-200 w-[120px] focus:outline-none focus:border-cyan-600 transition-colors"
                />
              </div>
              <button
                onClick={handleSearch}
                className="ml-auto flex items-center gap-1 px-3 py-1 bg-cyan-700/20 hover:bg-cyan-700/40 border border-cyan-700/40 hover:border-cyan-600 text-cyan-400 text-[11px] font-semibold rounded transition-all"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
                </svg>
                검색
              </button>
            </div>

            {/* Table */}
            <div className="flex-1 overflow-y-auto">
              <table className="w-full text-[12px]">
                <thead className="sticky top-0 bg-[#1a1d26]">
                  <tr className="border-b border-[#2d3748]">
                    <th className="text-left px-4 py-2 text-cyan-500 font-semibold">장비명</th>
                    <th className="text-center px-4 py-2 text-cyan-500 font-semibold">IP주소</th>
                  </tr>
                </thead>
                <tbody>
                  {pagedDevices.map((device, idx) => (
                    <tr
                      key={device.deviceId}
                      onClick={() => {
                        onSelect(device);
                        onClose();
                      }}
                      className={`cursor-pointer border-b border-[#2d3748]/30 transition-colors ${
                        idx % 2 === 0 ? 'bg-[#1a1d26]' : 'bg-[#161920]'
                      } hover:bg-cyan-500/10`}
                    >
                      <td className="px-4 py-2 text-gray-300">{device.deviceName.replace(/\s*IP-MPLS/gi, '')}</td>
                      <td className="px-4 py-2 text-gray-400 text-center font-mono">{device.deviceIpAddr}</td>
                    </tr>
                  ))}
                  {pagedDevices.length === 0 && (
                    <tr>
                      <td colSpan={2} className="px-4 py-8 text-center text-gray-600 text-[12px]">
                        검색 결과가 없습니다.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            <div className="flex items-center justify-between px-4 py-2 border-t border-[#2d3748]/50">
              <span className="text-[11px] text-gray-500">
                총 {filteredDevices.length}개 ({(currentPage - 1) * ITEMS_PER_PAGE + 1} ~ {Math.min(currentPage * ITEMS_PER_PAGE, filteredDevices.length)})
              </span>
              <div className="flex items-center gap-0.5">
                <button
                  onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                  disabled={currentPage === 1}
                  className="px-1.5 py-0.5 text-gray-500 hover:text-gray-300 disabled:opacity-30 disabled:cursor-not-allowed text-[12px]"
                >
                  ‹
                </button>
                {getPageNumbers().map((p, i) =>
                  typeof p === 'string' ? (
                    <span key={`ellipsis-${i}`} className="px-1 text-gray-600 text-[11px]">
                      ···
                    </span>
                  ) : (
                    <button
                      key={p}
                      onClick={() => setCurrentPage(p)}
                      className={`w-6 h-6 rounded text-[11px] transition-colors ${
                        currentPage === p
                          ? 'bg-cyan-600 text-white font-bold'
                          : 'text-gray-500 hover:bg-[#232733] hover:text-gray-300'
                      }`}
                    >
                      {p}
                    </button>
                  )
                )}
                <button
                  onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                  disabled={currentPage === totalPages}
                  className="px-1.5 py-0.5 text-gray-500 hover:text-gray-300 disabled:opacity-30 disabled:cursor-not-allowed text-[12px]"
                >
                  ›
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-center px-5 py-3 border-t border-[#2d3748]">
          <button
            onClick={onClose}
            className="px-5 py-1.5 border border-cyan-700/50 hover:border-cyan-500 text-cyan-400 hover:text-cyan-300 text-[12px] font-semibold rounded transition-all hover:bg-cyan-700/10"
          >
            닫기
          </button>
        </div>
      </div>
    </div>
  );
};

export default DeviceSelectModal;
