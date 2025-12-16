import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Home, Key, Image, Zap, Save, RotateCcw, Globe } from 'lucide-react';
import { Button, Input, Card, Loading, useToast, useConfirm } from '@/components/shared';
import * as api from '@/api/endpoints';
import type { OutputLanguage } from '@/api/endpoints';
import { OUTPUT_LANGUAGE_OPTIONS, getStoredOutputLanguage, storeOutputLanguage } from '@/api/endpoints';
import type { Settings as SettingsType } from '@/types';

export const Settings: React.FC = () => {
  const navigate = useNavigate();
  const { show, ToastContainer } = useToast();
  const { confirm, ConfirmDialog } = useConfirm();

  const [settings, setSettings] = useState<SettingsType | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [outputLanguage, setOutputLanguage] = useState<OutputLanguage | null>(() => {
    return getStoredOutputLanguage();
  });
  const [formData, setFormData] = useState({
    ai_provider_format: 'gemini' as 'openai' | 'gemini',
    api_base_url: '',
    api_key: '',
    image_resolution: '2K',
    image_aspect_ratio: '16:9',
    max_description_workers: 5,
    max_image_workers: 8,
  });

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    setIsLoading(true);
    try {
      const response = await api.getSettings();
      if (response.data) {
        setSettings(response.data);
        setFormData({
          ai_provider_format: response.data.ai_provider_format || 'gemini',
          api_base_url: response.data.api_base_url || '',
          api_key: '', // 不显示实际的 API key, 留空则在更新的时候不设置新的 apikey.
          image_resolution: response.data.image_resolution || '2K',
          image_aspect_ratio: response.data.image_aspect_ratio || '16:9',
          max_description_workers: response.data.max_description_workers || 5,
          max_image_workers: response.data.max_image_workers || 8,
        });
      }
    } catch (error: any) {
      console.error('加载设置失败:', error);
      show({
        message: '加载设置失败: ' + (error?.message || '未知错误'),
        type: 'error'
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      // 除了 api_key 以外的字段全部透传（包括空字符串），让后端决定语义
      const { api_key, ...otherData } = formData;
      const payload: Parameters<typeof api.updateSettings>[0] = {
        ...otherData,
      };

      // 只有当用户输入了新的 API Key 时才更新，留空表示“不修改当前 Key”
      if (api_key) {
        payload.api_key = api_key;
      }

      const response = await api.updateSettings(payload);
      if (response.data) {
        setSettings(response.data);
        show({ message: '设置保存成功', type: 'success' });
        // 清空 API key 输入框
        setFormData(prev => ({ ...prev, api_key: '' }));
      }
    } catch (error: any) {
      console.error('保存设置失败:', error);
      show({
        message: '保存设置失败: ' + (error?.response?.data?.error?.message || error?.message || '未知错误'),
        type: 'error'
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleLanguageChange = (language: OutputLanguage) => {
    storeOutputLanguage(language);
    setOutputLanguage(language);
    show({
      message: `输出语言已设置为: ${OUTPUT_LANGUAGE_OPTIONS.find(o => o.value === language)?.label}`,
      type: 'success',
    });
  };

  const handleReset = () => {
    confirm(
      '将把大模型、图像生成和并发等所有配置恢复为环境默认值，已保存的自定义设置将丢失，确定继续吗？',
      async () => {
        setIsSaving(true);
        try {
          const response = await api.resetSettings();
          if (response.data) {
            setSettings(response.data);
            setFormData({
              ai_provider_format: response.data.ai_provider_format || 'gemini',
              api_base_url: response.data.api_base_url || '',
              api_key: '',
              image_resolution: response.data.image_resolution || '2K',
              image_aspect_ratio: response.data.image_aspect_ratio || '16:9',
              max_description_workers: response.data.max_description_workers || 5,
              max_image_workers: response.data.max_image_workers || 8,
            });
            show({ message: '设置已重置', type: 'success' });
          }
        } catch (error: any) {
          console.error('重置设置失败:', error);
          show({
            message: '重置设置失败: ' + (error?.message || '未知错误'),
            type: 'error'
          });
        } finally {
          setIsSaving(false);
        }
      },
      {
        title: '确认重置为默认配置',
        confirmText: '确定重置',
        cancelText: '取消',
        variant: 'warning',
      }
    );
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-yellow-50 via-orange-50/30 to-pink-50/50 flex items-center justify-center">
        <Loading />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-yellow-50 via-orange-50/30 to-pink-50/50 relative overflow-hidden">
      {/* 背景装饰，和首页保持一致的氛围 */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -right-40 w-80 h-80 bg-banana-500/10 rounded-full blur-3xl animate-pulse"></div>
        <div className="absolute -bottom-40 -left-40 w-96 h-96 bg-orange-400/10 rounded-full blur-3xl animate-pulse" style={{ animationDelay: '1s' }}></div>
        <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-72 h-72 bg-yellow-400/5 rounded-full blur-3xl"></div>
      </div>

      {/* 居中模态卡片 */}
      <div className="relative min-h-screen flex items-center justify-center px-4 py-8">
        <div className="w-full max-w-4xl">
          <Card className="p-6 md:p-8 bg-white/90 backdrop-blur-xl shadow-2xl border-0">
            {/* 头部 */}
            <div className="flex items-center justify-between mb-6 md:mb-8">
              <div className="flex items-center gap-3">
                <Button
                  variant="ghost"
                  size="sm"
                  icon={<Home size={18} />}
                  onClick={() => navigate('/')}
                  className="text-xs md:text-sm"
                >
                  返回主页
                </Button>
                <div className="h-6 w-px bg-gray-200" />
                <div>
                  <h1 className="text-xl md:text-2xl font-bold text-gray-900">系统设置</h1>
                  <p className="mt-1 text-xs md:text-sm text-gray-500">
                    配置全局大模型、图像生成和性能参数
                  </p>
                </div>
              </div>
            </div>

          <div className="space-y-8">
            {/* API 配置 */}
            <div>
              <h2 className="text-xl font-semibold text-gray-900 mb-4 flex items-center">
                <Key size={20} className="mr-2" />
                大模型 API 配置
              </h2>
              <div className="space-y-4">
                {/* AI 提供商格式切换 */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    AI 提供商格式
                  </label>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => setFormData(prev => ({ ...prev, ai_provider_format: 'openai' }))}
                      className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                        formData.ai_provider_format === 'openai'
                          ? 'bg-gradient-to-r from-sky-500 to-blue-600 text-white shadow-md'
                          : 'bg-white border border-gray-200 text-gray-700 hover:bg-sky-50 hover:border-sky-300'
                      }`}
                    >
                      OpenAI 格式
                    </button>
                    <button
                      type="button"
                      onClick={() => setFormData(prev => ({ ...prev, ai_provider_format: 'gemini' }))}
                      className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                        formData.ai_provider_format === 'gemini'
                          ? 'bg-gradient-to-r from-emerald-500 to-green-600 text-white shadow-md'
                          : 'bg-white border border-gray-200 text-gray-700 hover:bg-emerald-50 hover:border-emerald-300'
                      }`}
                    >
                      Gemini 格式
                    </button>
                  </div>
                  <p className="mt-1 text-xs text-gray-500">
                    选择 API 请求格式，影响后端如何构造和发送请求。保存设置后生效。
                  </p>
                </div>
                <div>
                  <Input
                    label="API Base URL"
                    placeholder="https://api.example.com"
                    value={formData.api_base_url}
                    onChange={(e) => setFormData(prev => ({ ...prev, api_base_url: e.target.value }))}
                  />
                  <p className="mt-1 text-sm text-gray-500">
                    设置大模型提供商 API 的基础 URL
                  </p>
                </div>
                <div>
                  <Input
                    label="API Key"
                    type="password"
                    placeholder={settings?.api_key_length ? `已设置（长度: ${settings.api_key_length}）` : '输入新的 API Key'}
                    value={formData.api_key}
                    onChange={(e) => setFormData(prev => ({ ...prev, api_key: e.target.value }))}
                  />
                  <p className="mt-1 text-sm text-gray-500">
                    {settings?.api_key_length
                      ? '留空则保持当前设置不变，输入新值则更新'
                      : '输入你的 API Key'}
                  </p>
                </div>
              </div>
            </div>

            {/* 图像生成配置 */}
            <div>
              <h2 className="text-xl font-semibold text-gray-900 mb-4 flex items-center">
                <Image size={20} className="mr-2" />
                图像生成配置
              </h2>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    图像清晰度（某些OpenAI格式中转调整该值无效）
                  </label>
                  <select
                    value={formData.image_resolution}
                    onChange={(e) => setFormData(prev => ({ ...prev, image_resolution: e.target.value }))}
                    className="w-full h-10 px-4 rounded-lg border border-gray-200 bg-white focus:outline-none focus:ring-2 focus:ring-banana-500 focus:border-transparent"
                  >
                    <option value="1K">1K (1024px)</option>
                    <option value="2K">2K (2048px)</option>
                    <option value="4K">4K (4096px)</option>
                  </select>
                  <p className="mt-1 text-sm text-gray-500">
                    更高的清晰度会生成更详细的图像，但需要更长时间
                  </p>
                </div>
                {/* <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    图像比例
                  </label>
                  <select
                    value={formData.image_aspect_ratio}
                    onChange={(e) => setFormData(prev => ({ ...prev, image_aspect_ratio: e.target.value }))}
                    className="w-full h-10 px-4 rounded-lg border border-gray-200 bg-white focus:outline-none focus:ring-2 focus:ring-banana-500 focus:border-transparent"
                  >
                    <option value="1:1">1:1 (正方形)</option>
                    <option value="2:3">2:3 (竖向)</option>
                    <option value="3:2">3:2 (横向)</option>
                    <option value="3:4">3:4 (竖向)</option>
                    <option value="4:3">4:3 (标准)</option>
                    <option value="4:5">4:5 (竖向)</option>
                    <option value="5:4">5:4 (横向)</option>
                    <option value="9:16">9:16 (竖向)</option>
                    <option value="16:9">16:9 (宽屏)</option>
                    <option value="21:9">21:9 (超宽屏)</option>
                  </select>
                  <p className="mt-1 text-sm text-gray-500">
                    选择适合你 PPT 的图像比例
                  </p>
                </div> */}
              </div>
            </div>

            {/* 性能配置 */}
            <div>
              <h2 className="text-xl font-semibold text-gray-900 mb-4 flex items-center">
                <Zap size={20} className="mr-2" />
                性能配置
              </h2>
              <div className="space-y-4">
                <div>
                  <Input
                    label="描述生成最大并发数"
                    type="number"
                    min="1"
                    max="20"
                    value={formData.max_description_workers}
                    onChange={(e) => setFormData(prev => ({ ...prev, max_description_workers: parseInt(e.target.value) || 5 }))}
                  />
                  <p className="mt-1 text-sm text-gray-500">
                    同时生成描述的最大工作线程数 (1-20)，越大速度越快
                  </p>
                </div>
                <div>
                  <Input
                    label="图像生成最大并发数"
                    type="number"
                    min="1"
                    max="20"
                    value={formData.max_image_workers}
                    onChange={(e) => setFormData(prev => ({ ...prev, max_image_workers: parseInt(e.target.value) || 8 }))}
                  />
                  <p className="mt-1 text-sm text-gray-500">
                    同时生成图像的最大工作线程数 (1-20)，越大速度越快
                  </p>
                </div>
              </div>
            </div>

            {/* 输出语言设置 */}
            <div>
              <h2 className="text-xl font-semibold text-gray-900 mb-4 flex items-center">
                <Globe size={20} className="mr-2 text-blue-600" />
                输出语言设置
              </h2>
              <p className="text-sm text-gray-500 mb-3">
                这里设置的是默认输出语言，实际生成时会优先使用你最近一次选择的语言（保存在浏览器中）。
              </p>
              <div className="flex flex-wrap gap-2 md:gap-3">
                {OUTPUT_LANGUAGE_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    onClick={() => handleLanguageChange(option.value)}
                    className={`px-4 py-2 rounded-lg font-medium transition-all text-sm md:text-base ${
                      outputLanguage === option.value
                        ? 'bg-gradient-to-r from-blue-500 to-blue-600 text-white shadow-md'
                        : 'bg-white border border-gray-200 text-gray-700 hover:bg-blue-50 hover:border-blue-300'
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
              <p className="mt-2 text-xs text-gray-500">
                {outputLanguage === 'auto'
                  ? '自动模式：AI 将根据输入内容自动选择输出语言'
                  : `当前默认输出语言：${
                      OUTPUT_LANGUAGE_OPTIONS.find(o => o.value === outputLanguage)?.label || '未设置，按后端默认'
                    }`}
              </p>
            </div>

            {/* 操作按钮 */}
            <div className="flex items-center justify-between pt-4 border-t border-gray-200">
              <Button
                variant="secondary"
                icon={<RotateCcw size={18} />}
                onClick={handleReset}
                disabled={isSaving}
              >
                重置为默认值
              </Button>
              <Button
                variant="primary"
                icon={<Save size={18} />}
                onClick={handleSave}
                loading={isSaving}
              >
                保存设置
              </Button>
            </div>
          </div>
          </Card>
        </div>
      </div>

      <ToastContainer />
      {ConfirmDialog}
    </div>
  );
};
