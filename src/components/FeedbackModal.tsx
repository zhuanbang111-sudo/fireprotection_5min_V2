import React, { useState, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Send, MessageSquare, Camera, CheckCircle2, Loader2, AlertCircle, Paperclip } from 'lucide-react';
import axios from 'axios';

interface FeedbackModalProps {
  isOpen: boolean;
  onClose: () => void;
  user: any;
}

export const FeedbackModal: React.FC<FeedbackModalProps> = ({ isOpen, onClose, user }) => {
  const [content, setContent] = useState('');
  const [email, setEmail] = useState(user?.email || '');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [error, setError] = useState('');
  const [screenshot, setScreenshot] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleCaptureScreen = async () => {
    try {
      // 尝试使用浏览器的屏幕捕获 API
      // 注意：在 iframe 中可能会受限，需要用户授权
      // 这里的实现是一个简化的逻辑：如果 getDisplayMedia 可用则使用，否则提示手动上传
      if (navigator.mediaDevices && (navigator.mediaDevices as any).getDisplayMedia) {
        const stream = await (navigator.mediaDevices as any).getDisplayMedia({ video: true });
        const video = document.createElement('video');
        video.srcObject = stream;
        video.play();

        video.onloadedmetadata = () => {
          const canvas = document.createElement('canvas');
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
          const ctx = canvas.getContext('2d');
          
          // 给一点缓冲时间确保视频流渲染
          setTimeout(() => {
            ctx?.drawImage(video, 0, 0, canvas.width, canvas.height);
            const dataUrl = canvas.toDataURL('image/png');
            setScreenshot(dataUrl);
            
            // 停止所有轨道
            stream.getTracks().forEach((track: any) => track.stop());
          }, 500);
        };
      } else {
        setError('您的浏览器不支持自动截图，请手动选取文件上传。');
      }
    } catch (err: any) {
      console.error('Screen capture failed:', err);
      setError('截图权限被拒绝或发生错误。');
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (evt) => {
        setScreenshot(evt.target?.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!content.trim()) return;

    setIsSubmitting(true);
    setError('');

    try {
      const response = await axios.post('/api/feedback', {
        userId: user?.uid,
        email,
        content,
        screenshot, // Base64 string
      });

      if (response.data.success) {
        setIsSuccess(true);
        setTimeout(() => {
          setIsSuccess(false);
          onClose();
          setContent('');
          setScreenshot(null);
        }, 3000);
      }
    } catch (err: any) {
      console.error('Feedback submission failed:', err);
      setError(err.response?.data?.message || '提交失败，请检查网络后重试。');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
          />
          
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            className="relative w-full max-w-lg bg-white rounded-3xl shadow-2xl overflow-hidden"
          >
            <div className="bg-red-600 p-6 flex flex-col gap-1">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3 text-white">
                  <div className="bg-white/20 p-2 rounded-xl">
                    <MessageSquare size={24} />
                  </div>
                  <div>
                    <h2 className="text-xl font-black">反馈与建议</h2>
                    <p className="text-red-100 text-[10px] uppercase font-bold tracking-widest">Feedback & Support</p>
                  </div>
                </div>
                <button
                  onClick={onClose}
                  className="text-white/80 hover:text-white hover:bg-white/10 p-2 rounded-full transition-all"
                >
                  <X size={24} />
                </button>
              </div>
            </div>

            <div className="p-8">
              {isSuccess ? (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="py-12 flex flex-col items-center text-center space-y-4"
                >
                  <div className="w-16 h-16 bg-green-100 text-green-600 rounded-full flex items-center justify-center">
                    <CheckCircle2 size={40} />
                  </div>
                  <div>
                    <h3 className="text-lg font-bold text-slate-800">提交成功</h3>
                    <p className="text-sm text-slate-500 mt-1">感谢您的反馈，这能帮助我们做得更好。</p>
                  </div>
                </motion.div>
              ) : (
                <form onSubmit={handleSubmit} className="space-y-6">
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-wider ml-1">联系电子邮箱</label>
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="您的邮箱，方便我们回复您"
                      className="w-full h-12 bg-slate-50 border border-slate-200 rounded-xl px-4 text-sm focus:ring-2 focus:ring-red-500 focus:border-red-500 transition-all outline-none"
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-wider ml-1">反馈内容</label>
                    <textarea
                      required
                      value={content}
                      onChange={(e) => setContent(e.target.value)}
                      placeholder="请具体描述您遇到的问题或建议..."
                      className="w-full h-32 bg-slate-50 border border-slate-200 rounded-xl p-4 text-sm focus:ring-2 focus:ring-red-500 focus:border-red-500 transition-all outline-none resize-none"
                    />
                  </div>

                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <label className="text-[10px] font-black text-slate-400 uppercase tracking-wider ml-1">附加截图 (可选)</label>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => fileInputRef.current?.click()}
                          className="text-[10px] font-bold text-slate-600 hover:text-red-600 flex items-center gap-1 transition-colors"
                        >
                          <Paperclip size={12} />
                          上传文件
                        </button>
                        <button
                          type="button"
                          onClick={handleCaptureScreen}
                          className="text-[10px] font-bold text-slate-600 hover:text-red-600 flex items-center gap-1 transition-colors"
                        >
                          <Camera size={12} />
                          自动截屏
                        </button>
                      </div>
                      <input 
                        type="file" 
                        ref={fileInputRef} 
                        onChange={handleFileChange} 
                        accept="image/*" 
                        className="hidden" 
                      />
                    </div>

                    {screenshot && (
                      <div className="relative group">
                        <img 
                          src={screenshot} 
                          alt="Screenshot" 
                          className="w-full h-40 object-cover rounded-xl border-2 border-slate-100" 
                        />
                        <button
                          type="button"
                          onClick={() => setScreenshot(null)}
                          className="absolute top-2 right-2 bg-black/60 text-white p-1.5 rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                          <X size={14} />
                        </button>
                      </div>
                    )}
                  </div>

                  {error && (
                    <div className="flex items-center gap-3 bg-red-50 text-red-600 p-4 rounded-xl border border-red-100 text-xs font-bold">
                      <AlertCircle size={16} />
                      {error}
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={isSubmitting || !content.trim()}
                    className="w-full h-14 bg-red-600 hover:bg-red-700 text-white font-black rounded-2xl flex items-center justify-center gap-3 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-lg shadow-red-200 active:scale-95"
                  >
                    {isSubmitting ? (
                      <Loader2 className="w-5 h-5 animate-spin" />
                    ) : (
                      <>
                        <span>提交反馈</span>
                        <Send size={18} />
                      </>
                    )}
                  </button>
                </form>
              )}
            </div>
            
            <div className="bg-slate-50 p-4 border-t border-slate-100 text-center">
              <p className="text-[10px] text-slate-400 font-medium">
                您的反馈将有助于我们持续改进 <span className="text-red-600 font-bold">FireIsochrone PRO</span> 的仿真精度。
              </p>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};
