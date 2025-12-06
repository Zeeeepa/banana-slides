import React, { useState, useRef, useEffect } from 'react';
import { X, Save, Type, Pen, Image as ImageIcon, Trash2, Download, Loader2, MousePointer2, Square } from 'lucide-react';
import { Button, useToast } from '@/components/shared';
import { prepareComponentEditing, saveComponentLayout } from '@/api/endpoints';
import { getImageUrl } from '@/api/client';

interface ComponentData {
  id: number;
  url: string;
  bbox: [number, number, number, number];
  area: number;
  centroid: [number, number];
}

interface CanvasElement {
  id: string;
  type: 'component' | 'text' | 'image' | 'drawing';
  x: number;
  y: number;
  width?: number;
  height?: number;
  data: any;
}

interface ComponentEditorProps {
  projectId: string;
  pageId: string;
  onClose: () => void;
  onSave: () => void;
}

export const ComponentEditor: React.FC<ComponentEditorProps> = ({
  projectId,
  pageId,
  onClose,
  onSave,
}) => {
  const { show } = useToast();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [bgImageUrl, setBgImageUrl] = useState<string>('');
  const [canvasElements, setCanvasElements] = useState<CanvasElement[]>([]);
  const [selectedElement, setSelectedElement] = useState<string | null>(null);
  const [selectedElements, setSelectedElements] = useState<Set<string>>(new Set());
  const [tool, setTool] = useState<'select' | 'box-select' | 'text' | 'draw' | 'image'>('select');
  const [isDrawing, setIsDrawing] = useState(false);
  const [drawingPoints, setDrawingPoints] = useState<{ x: number; y: number }[]>([]);
  const [dragOffset, setDragOffset] = useState<{ x: number; y: number } | null>(null);
  const [selectionBox, setSelectionBox] = useState<{ startX: number; startY: number; endX: number; endY: number } | null>(null);
  const [isBoxSelecting, setIsBoxSelecting] = useState(false);
  const [multiDragOffsets, setMultiDragOffsets] = useState<Map<string, { x: number; y: number }>>(new Map());
  const [canvasSize] = useState({ width: 1920, height: 1080 });
  const [loadedImages, setLoadedImages] = useState<Map<string, HTMLImageElement>>(new Map());
  const [drawColor, setDrawColor] = useState('#000000');
  const [drawWidth, setDrawWidth] = useState(3);

  // 加载数据
  useEffect(() => {
    loadComponentData();
  }, [projectId, pageId]);

  // 绘制画布
  useEffect(() => {
    if (!isLoading && bgImageUrl) {
      drawCanvas();
    }
  }, [canvasElements, selectedElement, selectedElements, bgImageUrl, isLoading, loadedImages, selectionBox]);

  const loadComponentData = async () => {
    try {
      setIsLoading(true);
      const response = await prepareComponentEditing(projectId, pageId, {
        min_area: 100,
        white_threshold: 240,
      });

      if (response.data) {
        setBgImageUrl(response.data.pure_bg_image_url);

        // 将组件转换为画布元素
        const elements: CanvasElement[] = response.data.components.map((comp) => ({
          id: `comp-${comp.id}`,
          type: 'component',
          x: comp.bbox[0],
          y: comp.bbox[1],
          width: comp.bbox[2],
          height: comp.bbox[3],
          data: { url: comp.url },
        }));
        setCanvasElements(elements);

        // 预加载所有图片
        await loadAllImages([
          getImageUrl(response.data.pure_bg_image_url),
          ...response.data.components.map(c => getImageUrl(c.url))
        ]);
      }
    } catch (error: any) {
      show({ message: '加载失败: ' + (error.message || '未知错误'), type: 'error' });
      onClose();
    } finally {
      setIsLoading(false);
    }
  };

  const loadAllImages = async (urls: string[]) => {
    const imageMap = new Map<string, HTMLImageElement>();
    
    await Promise.all(
      urls.map(url => 
        new Promise<void>((resolve) => {
          const img = new Image();
          img.crossOrigin = 'anonymous';
          img.onload = () => {
            imageMap.set(url, img);
            resolve();
          };
          img.onerror = () => resolve(); // 失败也继续
          img.src = url;
        })
      )
    );
    
    setLoadedImages(imageMap);
  };

  const drawCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // 清空画布
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // 绘制背景
    const bgImg = loadedImages.get(getImageUrl(bgImageUrl));
    if (bgImg) {
      ctx.drawImage(bgImg, 0, 0, canvas.width, canvas.height);
    }

    // 绘制所有元素
    canvasElements.forEach((element) => {
      if (element.type === 'component' || element.type === 'image') {
        const img = loadedImages.get(getImageUrl(element.data.url));
        if (img && element.width && element.height) {
          ctx.drawImage(img, element.x, element.y, element.width, element.height);
        }
      } else if (element.type === 'text') {
        ctx.font = `${element.data.fontSize || 32}px ${element.data.fontFamily || 'Arial'}`;
        ctx.fillStyle = element.data.color || '#000000';
        ctx.textAlign = element.data.align || 'left';
        ctx.fillText(element.data.text, element.x, element.y);
      } else if (element.type === 'drawing') {
        ctx.strokeStyle = element.data.color || '#000000';
        ctx.lineWidth = element.data.width || 3;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        
        const points = element.data.points;
        if (points && points.length > 1) {
          ctx.beginPath();
          ctx.moveTo(points[0].x, points[0].y);
          for (let i = 1; i < points.length; i++) {
            ctx.lineTo(points[i].x, points[i].y);
          }
          ctx.stroke();
        }
      }

      // 绘制选中框
      if ((element.id === selectedElement || selectedElements.has(element.id)) && element.width && element.height) {
        ctx.strokeStyle = '#3B82F6';
        ctx.lineWidth = 3;
        ctx.setLineDash([5, 5]);
        ctx.strokeRect(element.x, element.y, element.width, element.height);
        ctx.setLineDash([]);
        
        // 绘制控制点
        const handleSize = 8;
        ctx.fillStyle = '#3B82F6';
        ctx.fillRect(element.x - handleSize/2, element.y - handleSize/2, handleSize, handleSize);
        ctx.fillRect(element.x + element.width - handleSize/2, element.y - handleSize/2, handleSize, handleSize);
        ctx.fillRect(element.x - handleSize/2, element.y + element.height - handleSize/2, handleSize, handleSize);
        ctx.fillRect(element.x + element.width - handleSize/2, element.y + element.height - handleSize/2, handleSize, handleSize);
      }
    });

    // 绘制选择框
    if (selectionBox) {
      const { startX, startY, endX, endY } = selectionBox;
      const x = Math.min(startX, endX);
      const y = Math.min(startY, endY);
      const width = Math.abs(endX - startX);
      const height = Math.abs(endY - startY);
      
      ctx.strokeStyle = '#3B82F6';
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 5]);
      ctx.strokeRect(x, y, width, height);
      
      ctx.fillStyle = 'rgba(59, 130, 246, 0.1)';
      ctx.fillRect(x, y, width, height);
      ctx.setLineDash([]);
    }
  };

  const getCanvasCoords = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };

    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    };
  };

  const findElementAt = (x: number, y: number): CanvasElement | null => {
    // 从后往前查找（最上层的元素优先）
    for (let i = canvasElements.length - 1; i >= 0; i--) {
      const el = canvasElements[i];
      if (
        el.width && el.height &&
        x >= el.x &&
        x <= el.x + el.width &&
        y >= el.y &&
        y <= el.y + el.height
      ) {
        return el;
      }
    }
    return null;
  };

  const handleCanvasMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const coords = getCanvasCoords(e);

    if (tool === 'select') {
      const element = findElementAt(coords.x, coords.y);
      if (element) {
        // 如果点击的是已选中的多选元素之一，准备拖动所有选中的元素
        if (selectedElements.has(element.id)) {
          const offsets = new Map<string, { x: number; y: number }>();
          canvasElements.forEach(el => {
            if (selectedElements.has(el.id)) {
              offsets.set(el.id, { x: coords.x - el.x, y: coords.y - el.y });
            }
          });
          setMultiDragOffsets(offsets);
        } else {
          // 单选
          setSelectedElement(element.id);
          setSelectedElements(new Set());
          setDragOffset({ x: coords.x - element.x, y: coords.y - element.y });
        }
      } else {
        setSelectedElement(null);
        setSelectedElements(new Set());
      }
    } else if (tool === 'box-select') {
      setIsBoxSelecting(true);
      setSelectionBox({ startX: coords.x, startY: coords.y, endX: coords.x, endY: coords.y });
    } else if (tool === 'draw') {
      setIsDrawing(true);
      setDrawingPoints([coords]);
    } else if (tool === 'text') {
      addTextElement(coords.x, coords.y);
    }
  };

  const handleCanvasMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const coords = getCanvasCoords(e);

    if (tool === 'select') {
      if (multiDragOffsets.size > 0) {
        // 拖动多个选中的元素
        setCanvasElements(elements =>
          elements.map(el => {
            const offset = multiDragOffsets.get(el.id);
            if (offset) {
              return { ...el, x: coords.x - offset.x, y: coords.y - offset.y };
            }
            return el;
          })
        );
      } else if (selectedElement && dragOffset) {
        // 拖动单个元素
        setCanvasElements(elements =>
          elements.map(el =>
            el.id === selectedElement
              ? { ...el, x: coords.x - dragOffset.x, y: coords.y - dragOffset.y }
              : el
          )
        );
      }
    } else if (tool === 'box-select' && isBoxSelecting && selectionBox) {
      // 更新选择框
      setSelectionBox({ ...selectionBox, endX: coords.x, endY: coords.y });
    } else if (tool === 'draw' && isDrawing) {
      setDrawingPoints(points => [...points, coords]);
      // 实时绘制
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext('2d');
      if (ctx && drawingPoints.length > 0) {
        const lastPoint = drawingPoints[drawingPoints.length - 1];
        ctx.strokeStyle = drawColor;
        ctx.lineWidth = drawWidth;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(lastPoint.x, lastPoint.y);
        ctx.lineTo(coords.x, coords.y);
        ctx.stroke();
      }
    }
  };

  const handleCanvasMouseUp = () => {
    if (tool === 'select') {
      setDragOffset(null);
      setMultiDragOffsets(new Map());
    } else if (tool === 'box-select' && isBoxSelecting && selectionBox) {
      // 完成框选
      const { startX, startY, endX, endY } = selectionBox;
      const boxX = Math.min(startX, endX);
      const boxY = Math.min(startY, endY);
      const boxWidth = Math.abs(endX - startX);
      const boxHeight = Math.abs(endY - startY);
      
      // 查找所有与选择框相交的元素
      const selected = new Set<string>();
      canvasElements.forEach(el => {
        if (el.width && el.height) {
          // 检测矩形相交
          const intersects = !(
            el.x + el.width < boxX ||
            el.x > boxX + boxWidth ||
            el.y + el.height < boxY ||
            el.y > boxY + boxHeight
          );
          
          if (intersects) {
            selected.add(el.id);
          }
        }
      });
      
      setSelectedElements(selected);
      setSelectedElement(null);
      setIsBoxSelecting(false);
      setSelectionBox(null);
    } else if (tool === 'draw' && isDrawing) {
      // 保存绘制路径
      if (drawingPoints.length > 1) {
        const newElement: CanvasElement = {
          id: `draw-${Date.now()}`,
          type: 'drawing',
          x: Math.min(...drawingPoints.map(p => p.x)),
          y: Math.min(...drawingPoints.map(p => p.y)),
          data: {
            points: drawingPoints,
            color: drawColor,
            width: drawWidth,
          },
        };
        setCanvasElements([...canvasElements, newElement]);
      }
      setIsDrawing(false);
      setDrawingPoints([]);
    }
  };

  const addTextElement = (x: number, y: number) => {
    const text = prompt('输入文本内容：');
    if (!text) return;

    const newElement: CanvasElement = {
      id: `text-${Date.now()}`,
      type: 'text',
      x,
      y,
      data: {
        text,
        fontSize: 32,
        fontFamily: 'Arial',
        color: '#000000',
        align: 'left',
      },
    };
    setCanvasElements([...canvasElements, newElement]);
    setTool('select');
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const reader = new FileReader();
      reader.onload = async (event) => {
        const dataUrl = event.target?.result as string;
        
        // 加载图片获取尺寸
        const img = new Image();
        img.onload = () => {
          const newElement: CanvasElement = {
            id: `img-${Date.now()}`,
            type: 'image',
            x: 100,
            y: 100,
            width: img.width,
            height: img.height,
            data: { url: dataUrl },
          };
          
          // 添加到已加载图片
          setLoadedImages(new Map(loadedImages.set(dataUrl, img)));
          setCanvasElements([...canvasElements, newElement]);
          setTool('select');
        };
        img.src = dataUrl;
      };
      reader.readAsDataURL(file);
    } catch (error: any) {
      show({ message: '上传图片失败', type: 'error' });
    }

    // 重置input
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const deleteSelectedElement = () => {
    if (selectedElements.size > 0) {
      // 删除多选的元素
      setCanvasElements(canvasElements.filter(el => !selectedElements.has(el.id)));
      setSelectedElements(new Set());
    } else if (selectedElement) {
      // 删除单选的元素
      setCanvasElements(canvasElements.filter(el => el.id !== selectedElement));
      setSelectedElement(null);
    }
  };

  const handleSave = async () => {
    try {
      setIsSaving(true);
      const canvas = canvasRef.current;
      if (!canvas) return;

      // 导出画布为data URL
      const dataUrl = canvas.toDataURL('image/png');
      
      // 保存到后端
      await saveComponentLayout(projectId, pageId, dataUrl);
      
      show({ message: '保存成功！', type: 'success' });
      onSave();
      onClose();
    } catch (error: any) {
      show({ message: '保存失败: ' + (error.message || '未知错误'), type: 'error' });
    } finally {
      setIsSaving(false);
    }
  };

  const handleExportImage = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const link = document.createElement('a');
    link.download = `slide-${pageId}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
  };

  if (isLoading) {
    return (
      <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center">
        <div className="bg-white rounded-lg p-8 text-center">
          <Loader2 className="w-12 h-12 animate-spin text-banana-500 mx-auto mb-4" />
          <p className="text-gray-600">正在准备编辑器...</p>
          <p className="text-sm text-gray-500 mt-2">AI正在生成白底图和纯背景图</p>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-gray-900 z-50 flex flex-col">
      {/* 顶部工具栏 */}
      <div className="bg-white border-b border-gray-200 px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <h2 className="text-lg font-semibold text-gray-900">组件编辑器</h2>
          <div className="h-6 w-px bg-gray-300" />
          
          {/* 工具按钮 */}
          <div className="flex items-center gap-2">
            <Button
              variant={tool === 'select' ? 'primary' : 'secondary'}
              size="sm"
              icon={<MousePointer2 size={16} />}
              onClick={() => setTool('select')}
              title="选择工具 - 点击选中单个元素并拖动"
            >
              选择
            </Button>
            <Button
              variant={tool === 'box-select' ? 'primary' : 'secondary'}
              size="sm"
              icon={<Square size={16} />}
              onClick={() => setTool('box-select')}
              title="框选工具 - 拖动选择多个元素"
            >
              框选
            </Button>
            <Button
              variant={tool === 'text' ? 'primary' : 'secondary'}
              size="sm"
              icon={<Type size={16} />}
              onClick={() => setTool('text')}
              title="文本工具 - 点击添加文本"
            >
              文本
            </Button>
            <Button
              variant={tool === 'draw' ? 'primary' : 'secondary'}
              size="sm"
              icon={<Pen size={16} />}
              onClick={() => setTool('draw')}
              title="涂鸦工具 - 按住拖动绘画"
            >
              涂鸦
            </Button>
            <Button
              variant="secondary"
              size="sm"
              icon={<ImageIcon size={16} />}
              onClick={() => fileInputRef.current?.click()}
              title="上传图片"
            >
              上传图片
            </Button>
          </div>

          {/* 绘画选项 */}
          {tool === 'draw' && (
            <>
              <div className="h-6 w-px bg-gray-300" />
              <div className="flex items-center gap-2">
                <label className="text-sm text-gray-600">颜色:</label>
                <input
                  type="color"
                  value={drawColor}
                  onChange={(e) => setDrawColor(e.target.value)}
                  className="w-8 h-8 rounded cursor-pointer"
                />
                <label className="text-sm text-gray-600 ml-2">粗细:</label>
                <input
                  type="range"
                  min="1"
                  max="20"
                  value={drawWidth}
                  onChange={(e) => setDrawWidth(Number(e.target.value))}
                  className="w-24"
                />
                <span className="text-sm text-gray-600">{drawWidth}px</span>
              </div>
            </>
          )}

          {(selectedElement || selectedElements.size > 0) && (
            <>
              <div className="h-6 w-px bg-gray-300" />
              <div className="flex items-center gap-2">
                {selectedElements.size > 0 && (
                  <span className="text-sm text-gray-600">
                    已选中 {selectedElements.size} 个元素
                  </span>
                )}
                <Button
                  variant="secondary"
                  size="sm"
                  icon={<Trash2 size={16} />}
                  onClick={deleteSelectedElement}
                >
                  删除
                </Button>
              </div>
            </>
          )}
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            icon={<Download size={16} />}
            onClick={handleExportImage}
          >
            导出
          </Button>
          <Button
            variant="primary"
            size="sm"
            icon={<Save size={16} />}
            onClick={handleSave}
            loading={isSaving}
            disabled={isSaving}
          >
            保存并应用
          </Button>
          <Button
            variant="ghost"
            size="sm"
            icon={<X size={16} />}
            onClick={onClose}
            disabled={isSaving}
          >
            关闭
          </Button>
        </div>
      </div>

      {/* 画布区域 */}
      <div className="flex-1 overflow-auto bg-gray-800 flex items-center justify-center p-8">
        <div className="bg-white rounded-lg shadow-2xl" style={{ aspectRatio: '16/9' }}>
          <canvas
            ref={canvasRef}
            width={canvasSize.width}
            height={canvasSize.height}
            className="w-full h-full cursor-crosshair"
            onMouseDown={handleCanvasMouseDown}
            onMouseMove={handleCanvasMouseMove}
            onMouseUp={handleCanvasMouseUp}
            onMouseLeave={handleCanvasMouseUp}
          />
        </div>
      </div>

      {/* 隐藏的文件输入 */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        onChange={handleImageUpload}
        className="hidden"
      />

      {/* 底部提示 */}
      <div className="bg-white border-t border-gray-200 px-4 py-2 text-center text-sm text-gray-600">
        {tool === 'select' && '💡 点击元素选中，拖动移动位置'}
        {tool === 'box-select' && '💡 按住鼠标拖动绘制选择框，批量选中多个元素后可一起拖动'}
        {tool === 'text' && '💡 点击画布添加文本'}
        {tool === 'draw' && '💡 按住鼠标拖动进行涂鸦绘画'}
        {tool === 'image' && '💡 点击上传图片按钮选择图片'}
      </div>
    </div>
  );
};

