import React, { useState, useEffect, useRef } from 'react';
import { 
  Gem, Monitor, ListOrdered, Users, PhoneCall, Search, Upload, Eye, 
  AlertTriangle, MessageSquare, ChevronDown, LogIn, LogOut, Plus, Edit2, Trash2, X, RefreshCw, CheckCircle
} from 'lucide-react';
import { auth, db, logout } from './firebase';
import { onAuthStateChanged, User, signInWithEmailAndPassword, createUserWithEmailAndPassword } from 'firebase/auth';
import { 
  collection, onSnapshot, query, orderBy, doc, writeBatch, 
  getDoc, setDoc, updateDoc, deleteDoc, runTransaction, where 
} from 'firebase/firestore';
import toast, { Toaster } from 'react-hot-toast';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';

interface UserProfile {
  name: string;
  role: 'admin' | 'worker';
  email: string;
}

interface Order {
  id: string;
  orderNo: number;
  displayId: string;
  createdAt: string;
  bossId: string;
  workerA: string;
  workerAId: string;
  workerB: string;
  workerBId: string;
  assignedWorkerIds: string[];
  amount: number;
  details: string;
  screenshots: number;
  status: '进行中' | '待审核' | '已完成';
  uid: string;
}

interface Employee {
  id: string;
  name: string;
  status: string;
  isAvailable: boolean;
  uid: string;
}

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [showProfileSetup, setShowProfileSetup] = useState(false);
  
  const [activeTab, setActiveTab] = useState<'orders' | 'employees'>('orders');
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('全部状态');
  const [workerFilter, setWorkerFilter] = useState('全部打手');
  
  const [orders, setOrders] = useState<Order[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);

  // Modals state
  const [showCreateOrder, setShowCreateOrder] = useState(false);
  const [showCreateEmployee, setShowCreateEmployee] = useState(false);
  const [showUserCenter, setShowUserCenter] = useState(false);
  const [editingOrder, setEditingOrder] = useState<Order | null>(null);
  const [orderToDelete, setOrderToDelete] = useState<string | null>(null);
  const [employeeToDelete, setEmployeeToDelete] = useState<string | null>(null);
  const [renameTarget, setRenameTarget] = useState<{ type: 'user' | 'employee', id: string, currentName: string } | null>(null);
  const [selectedEmployee, setSelectedEmployee] = useState<Employee | null>(null);
  const [selectedWorkerAId, setSelectedWorkerAId] = useState<string>('');
  const [historyPeriod, setHistoryPeriod] = useState<'today' | 'month' | 'all'>('month');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [activeActionOrderId, setActiveActionOrderId] = useState<string | null>(null);
  
  // Bulk delete state
  const [isEditEmployeeMode, setIsEditEmployeeMode] = useState(false);
  const [selectedEmployeeIds, setSelectedEmployeeIds] = useState<string[]>([]);
  
  // Screenshot upload state
  const [uploadScreenshotOrderId, setUploadScreenshotOrderId] = useState<string | null>(null);
  const [viewScreenshotsOrderId, setViewScreenshotsOrderId] = useState<string | null>(null);

  const isFirstLoad = useRef(true);
  const prevPendingOrderIds = useRef<Set<string>>(new Set());

  // Email/Password auth state
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [isRegisterMode, setIsRegisterMode] = useState(false);
  const [authError, setAuthError] = useState('');

  // Profile setup handles user and employee sync correctly, but missing uid field might cause issues if not updated correctly.
  
  // Auth Handlers
  const handleEmailAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError('');
    setIsSubmitting(true);
    try {
      if (isRegisterMode) {
        await createUserWithEmailAndPassword(auth, authEmail, authPassword);
      } else {
        await signInWithEmailAndPassword(auth, authEmail, authPassword);
      }
    } catch (err: any) {
      console.error(err);
      if (err.code === 'auth/email-already-in-use') {
        setAuthError('该邮箱已被注册');
      } else if (err.code === 'auth/user-not-found' || err.code === 'auth/wrong-password' || err.code === 'auth/invalid-credential') {
        setAuthError('账号或密码错误');
      } else if (err.code === 'auth/weak-password') {
        setAuthError('密码至少需要6位');
      } else if (err.code === 'auth/invalid-email') {
        setAuthError('邮箱格式不正确');
      } else {
        setAuthError(err.message || '认证失败，请重试');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  // Auth & Profile Fetching
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);
      if (currentUser) {
        const profileDoc = await getDoc(doc(db, 'users', currentUser.uid));
        if (profileDoc.exists()) {
          setUserProfile(profileDoc.data() as UserProfile);
        } else {
          setShowProfileSetup(true);
        }
      } else {
        setUserProfile(null);
      }
      setIsAuthReady(true);
    });
    return () => unsubscribe();
  }, []);

  // Fetch Employees
  useEffect(() => {
    if (!isAuthReady || !user || !userProfile) return;

    const qEmployees = query(collection(db, 'employees'));
    const unsubscribeEmployees = onSnapshot(qEmployees, (snapshot) => {
      const employeesData: Employee[] = [];
      snapshot.forEach((doc) => employeesData.push({ id: doc.id, ...doc.data() } as Employee));
      setEmployees(employeesData);
    });

    return () => unsubscribeEmployees();
  }, [isAuthReady, user, userProfile]);

  // Fetch Orders
  useEffect(() => {
    if (!isAuthReady || !user || !userProfile) return;

    let qOrders;
    if (userProfile.role === 'admin') {
      qOrders = query(collection(db, 'orders'), orderBy('orderNo', 'desc'));
    } else {
      const myEmployeeRecord = employees.find(e => e.uid === user.uid);
      if (!myEmployeeRecord) {
        setOrders([]);
        return;
      }
      qOrders = query(collection(db, 'orders'), where('assignedWorkerIds', 'array-contains', myEmployeeRecord.id));
    }

    isFirstLoad.current = true;

    const unsubscribeOrders = onSnapshot(qOrders, (snapshot) => {
      const ordersData: Order[] = [];
      snapshot.forEach((docSnap) => {
        const data = docSnap.data();
        let status = data.status;
        if (status === '未完成') {
          status = '进行中';
          // Best-effort auto-migration of old data
          updateDoc(doc(db, 'orders', docSnap.id), { status: '进行中' }).catch(() => {});
        }
        ordersData.push({ id: docSnap.id, ...data, status } as Order);
      });
      
      // Sort manually for workers since we can't use orderBy with array-contains without an index
      if (userProfile.role === 'worker') {
        ordersData.sort((a, b) => b.orderNo - a.orderNo);
      }
      setOrders(ordersData);

      // Notifications for active/new orders
      if (userProfile.role === 'admin') {
        const currentPendingIds = new Set(ordersData.filter(o => o.status === '待审核').map(o => o.id));
        if (isFirstLoad.current) {
          if (currentPendingIds.size > 0) {
            toast.success(`您有 ${currentPendingIds.size} 个订单待审核`, {
              icon: '🔔',
              duration: 5000,
              style: { borderRadius: '10px', background: '#1A1D24', color: '#fff', border: '1px solid rgba(255,255,255,0.1)' }
            });
          }
        } else {
          // Check if any NEW pending orders were added to the list since last snapshot
          const hasNewPending = [...currentPendingIds].some(id => !prevPendingOrderIds.current.has(id));
          if (hasNewPending) {
            toast.success(`您有 ${currentPendingIds.size} 个订单待审核`, {
              icon: '🔔',
              duration: 5000,
              style: { borderRadius: '10px', background: '#1A1D24', color: '#fff', border: '1px solid rgba(255,255,255,0.1)' }
            });
          }
        }
        prevPendingOrderIds.current = currentPendingIds;
      } else if (userProfile.role === 'worker') {
        if (isFirstLoad.current) {
          // Notify on login/re-load if there is a pending order
          const activeOrder = ordersData.find(o => o.status === '进行中');
          if (activeOrder) {
            toast.success(`您有一个进行中的订单: #${activeOrder.displayId}`, {
              icon: '🔔',
              duration: 5000,
              style: { borderRadius: '10px', background: '#1A1D24', color: '#fff', border: '1px solid rgba(255,255,255,0.1)' }
            });
          }
        } else {
          // Notify on newly added assignments
          snapshot.docChanges().forEach((change) => {
            if (change.type === 'added') {
              const order = change.doc.data() as Order;
              if (order.status === '进行中') {
                toast.success(`新订单指派给您: #${order.displayId}`, {
                  icon: '🔔',
                  duration: 5000,
                  style: { borderRadius: '10px', background: '#1A1D24', color: '#fff', border: '1px solid rgba(255,255,255,0.1)' }
                });
              }
            }
          });
        }
      }
      isFirstLoad.current = false;
    });

    return () => unsubscribeOrders();
  }, [isAuthReady, user, userProfile, userProfile?.role === 'worker' ? employees.find(e => e.uid === user?.uid)?.id : null]);

  // Handle Profile Setup
  const handleProfileSetup = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!user || isSubmitting) return;
    setIsSubmitting(true);
    const formData = new FormData(e.currentTarget);
    const name = formData.get('name') as string;
    const role = formData.get('role') as 'admin' | 'worker';

    try {
      const batch = writeBatch(db);
      const userRef = doc(db, 'users', user.uid);
      batch.set(userRef, { name, role, email: user.email });

      if (role === 'worker') {
        const empRef = doc(db, 'employees', user.uid);
        batch.set(empRef, { name, status: '空闲', isAvailable: true, uid: user.uid });
      }
      await batch.commit();
      setUserProfile({ name, role, email: user.email || '' });
      setShowProfileSetup(false);
      toast.success('资料设置成功！');
    } catch (error) {
      console.error(error);
      toast.error('设置失败');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Handle Create Order
  const handleCreateOrder = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!user || isSubmitting) return;
    setIsSubmitting(true);
    const formData = new FormData(e.currentTarget);
    const bossId = formData.get('bossId') as string;
    const workerAId = formData.get('workerAId') as string;
    const workerBId = formData.get('workerBId') as string;
    const amount = Number(formData.get('amount'));

    try {
      await runTransaction(db, async (transaction) => {
        const counterRef = doc(db, 'counters', 'orders');
        const counterDoc = await transaction.get(counterRef);
        let nextId = 1;
        if (counterDoc.exists()) {
          nextId = counterDoc.data().lastId + 1;
        }
        transaction.set(counterRef, { lastId: nextId }, { merge: true });

        const orderRef = doc(collection(db, 'orders'));
        const displayId = nextId.toString().padStart(3, '0');

        const workerA = employees.find(emp => emp.id === workerAId);
        const workerB = employees.find(emp => emp.id === workerBId);

        const assignedWorkerIds = [];
        if (workerA) assignedWorkerIds.push(workerA.id);
        if (workerB) assignedWorkerIds.push(workerB.id);

        transaction.set(orderRef, {
          orderNo: nextId,
          displayId,
          createdAt: new Date().toISOString(),
          bossId,
          workerA: workerA ? workerA.name : '',
          workerAId: workerA ? workerA.id : '',
          workerB: workerB ? workerB.name : '',
          workerBId: workerB ? workerB.id : '',
          assignedWorkerIds,
          amount,
          details: formData.get('details') as string || '',
          screenshots: 0,
          status: '进行中',
          uid: user.uid
        });

        // Update assigned workers status to Busy
        if (workerA) transaction.update(doc(db, 'employees', workerA.id), { status: '接单中', isAvailable: false });
        if (workerB) transaction.update(doc(db, 'employees', workerB.id), { status: '接单中', isAvailable: false });
      });
      setShowCreateOrder(false);
      setSelectedWorkerAId('');
      toast.success('派单成功！');
    } catch (error) {
      console.error(error);
      toast.error('派单失败');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Handle Update Order
  const handleUpdateOrder = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!editingOrder || isSubmitting) return;
    setIsSubmitting(true);
    
    const formData = new FormData(e.currentTarget);
    const updates: any = {};

    if (userProfile?.role === 'admin') {
      updates.bossId = formData.get('bossId');
      updates.amount = Number(formData.get('amount'));
    } else {
      updates.details = formData.get('details');
      updates.screenshots = Number(formData.get('screenshots'));
    }

    try {
      await updateDoc(doc(db, 'orders', editingOrder.id), updates);
      setEditingOrder(null);
      toast.success('更新成功！');
    } catch (error) {
      console.error(error);
      toast.error('更新失败');
    } finally {
      setIsSubmitting(false);
    }
  };

  const confirmDeleteOrder = async () => {
    if (!orderToDelete || isDeleting) return;
    setIsDeleting(true);
    try {
      const orderId = orderToDelete;
      const order = orders.find(o => o.id === orderId);
      if(!order) return;

      const batch = writeBatch(db);
      batch.update(doc(db, 'orders', orderId), { status: '已作废' });

      for (const wId of order.assignedWorkerIds) {
         const hasOtherActive = orders.some(o => 
           o.id !== orderId && 
           o.assignedWorkerIds.includes(wId) && 
           o.status === '进行中'
         );
         if (!hasOtherActive) {
            const emp = employees.find(e => e.id === wId);
            if (emp && emp.status === '接单中') {
               batch.update(doc(db, 'employees', wId), { status: '空闲', isAvailable: true });
            }
         }
      }
      
      await batch.commit();

      toast.success('订单已作废');
    } catch (error) {
      console.error(error);
      toast.error('操作失败');
    } finally {
      setIsDeleting(false);
      setOrderToDelete(null);
    }
  };

  const confirmDeleteEmployee = async () => {
    if (!employeeToDelete || isDeleting) return;
    setIsDeleting(true);
    try {
      await deleteDoc(doc(db, 'employees', employeeToDelete));
      if (selectedEmployee?.id === employeeToDelete) {
        setSelectedEmployee(null);
      }
      toast.success('员工已删除');
    } catch (error) {
      console.error(error);
      toast.error('删除失败');
    } finally {
      setIsDeleting(false);
      setEmployeeToDelete(null);
    }
  };

  // Handle Bulk Delete Employees
  const handleDeleteMultipleEmployees = async () => {
    if (selectedEmployeeIds.length === 0 || isDeleting) return;
    if (!window.confirm(`确定要删除选中的 ${selectedEmployeeIds.length} 个员工吗？\n注意：将会同时删除相关员工的指派记录。`)) return;

    setIsDeleting(true);
    try {
      const batch = writeBatch(db);
      selectedEmployeeIds.forEach(id => {
        batch.delete(doc(db, 'employees', id));
      });
      await batch.commit();
      
      toast.success(`已成功删除 ${selectedEmployeeIds.length} 个员工`);
      setSelectedEmployeeIds([]);
      setIsEditEmployeeMode(false);
    } catch (error) {
      console.error(error);
      toast.error('删除失败');
    } finally {
      setIsDeleting(false);
    }
  };

  const handleRenameSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!renameTarget || isSubmitting) return;
    setIsSubmitting(true);
    const formData = new FormData(e.currentTarget);
    const newName = formData.get('newName') as string;

    if (newName && newName.trim() !== '' && newName !== renameTarget.currentName) {
      try {
        if (renameTarget.type === 'employee') {
          await updateDoc(doc(db, 'employees', renameTarget.id), { name: newName.trim() });
          if (selectedEmployee && selectedEmployee.id === renameTarget.id) {
            setSelectedEmployee({ ...selectedEmployee, name: newName.trim() });
          }
          toast.success('员工姓名已更新');
        } else if (renameTarget.type === 'user' && userProfile && user) {
          const batch = writeBatch(db);
          const userRef = doc(db, 'users', user.uid);
          batch.update(userRef, { name: newName.trim() });
          
          const employeeRecord = employees.find(e => e.uid === user.uid);
          if (employeeRecord) {
            const empRef = doc(db, 'employees', employeeRecord.id);
            batch.update(empRef, { name: newName.trim() });
          }
          
          await batch.commit();
          setUserProfile({ ...userProfile, name: newName.trim() });
          toast.success('个人姓名已更新');
        }
        setRenameTarget(null);
      } catch (error) {
        console.error(error);
        toast.error('更新失败');
      }
    } else {
      setRenameTarget(null);
    }
    setIsSubmitting(false);
  };

  const handleStatusChange = async (orderId: string, newStatus: string) => {
    try {
      const order = orders.find(o => o.id === orderId);
      if (!order) return;
      
      const batch = writeBatch(db);
      batch.update(doc(db, 'orders', orderId), { status: newStatus });
      
      // If approved (completed) or pending review (service completed), check if workers have other active orders
      if (newStatus === '已完成' || newStatus === '待审核') {
         for (const wId of order.assignedWorkerIds) {
            const hasOtherActive = orders.some(o => 
              o.id !== orderId && 
              o.assignedWorkerIds.includes(wId) && 
              o.status === '进行中'
            );
            if (!hasOtherActive) {
                if (newStatus === '待审核') {
                    // 打手当前订单点击服务完成后就应该自动开启呼叫派单，状态也应该为空闲
                    batch.update(doc(db, 'employees', wId), { status: '空闲', isAvailable: true });
                } else if (newStatus === '已完成') {
                    // For admin approval, if employee happens to be stuck in '接单中' without active orders, reset them
                    const emp = employees.find(e => e.id === wId);
                    if (emp && emp.status === '接单中') {
                        batch.update(doc(db, 'employees', wId), { status: '空闲', isAvailable: true });
                    }
                }
            }
         }
      }
      
      await batch.commit();
      toast.success(newStatus === '已完成' ? '订单已审核通过' : '状态已更新');
    } catch (error) {
      console.error(error);
      toast.error('更新失败');
    }
  };

  // Handle Create Employee
  const handleCreateEmployee = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!user || isSubmitting) return;
    setIsSubmitting(true);
    const formData = new FormData(e.currentTarget);
    const employeeUid = formData.get('employeeUid') as string;

    if (!employeeUid) {
       toast.error('必须输入员工UID');
       setIsSubmitting(false);
       return;
    }

      try {
      const existingEmp = employees.find(emp => emp.uid === employeeUid);
      if (existingEmp) {
        toast.error('该UID已被添加为员工');
        setIsSubmitting(false);
        return;
      }

      const userDocRef = doc(db, 'users', employeeUid);
      const userDocSnap = await getDoc(userDocRef);
      
      let empName = `员工_${employeeUid.slice(0, 4)}`;
      if (userDocSnap.exists()) {
        empName = userDocSnap.data().name;
      } else {
        toast.error('未找到该UID对应的用户记录，将使用默认名称');
      }

      const empRef = doc(collection(db, 'employees'));
      await setDoc(empRef, {
        name: empName,
        status: '离线',
        isAvailable: false,
        uid: employeeUid
      });
      setShowCreateEmployee(false);
      toast.success('添加员工成功！');
    } catch (error) {
      console.error(error);
      toast.error('添加失败');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isAuthReady) {
    return <div className="min-h-screen bg-[#0F1115] flex items-center justify-center text-[#E5E7EB]">加载中...</div>;
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-[#0F1115] flex items-center justify-center text-[#E5E7EB] font-sans">
        <div className="bg-[#1A1D24] p-8 rounded-2xl border border-white/10 shadow-xl max-w-md w-full text-center">
          <div className="flex justify-center mb-6">
            <div className="w-16 h-16 bg-[#4F46E5]/20 rounded-2xl flex items-center justify-center border border-[#4F46E5]/30">
              <Gem className="w-8 h-8 text-[#4F46E5]" />
            </div>
          </div>
          <h1 className="text-2xl font-bold text-white mb-2">安生工作室派单系统</h1>
          <p className="text-[#9CA3AF] mb-8 text-sm">请登录以访问控制台并管理您的订单与员工</p>
          <form onSubmit={handleEmailAuth} className="flex flex-col gap-4 text-left">
            <div>
              <label className="block text-sm font-medium text-white mb-1">邮箱</label>
              <input 
                type="email" 
                required 
                value={authEmail}
                onChange={e => setAuthEmail(e.target.value)}
                className="w-full bg-[#0F1115] border border-white/10 rounded-lg px-4 py-3 text-white focus:outline-none focus:border-indigo-500 transition-colors"
                placeholder="请输入邮箱"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-white mb-1">密码</label>
              <input 
                type="password" 
                required 
                value={authPassword}
                onChange={e => setAuthPassword(e.target.value)}
                className="w-full bg-[#0F1115] border border-white/10 rounded-lg px-4 py-3 text-white focus:outline-none focus:border-indigo-500 transition-colors"
                placeholder="请输入密码（最少6位）"
              />
            </div>
            {authError && <p className="text-red-500 text-sm mt-1">{authError}</p>}
            <button 
              type="submit"
              disabled={isSubmitting}
              className="w-full flex items-center justify-center gap-3 px-6 py-3 mt-2 bg-[#4F46E5] hover:bg-indigo-500 disabled:opacity-50 text-white font-semibold rounded-xl shadow-[0_4px_14px_rgba(79,70,229,0.3)] transition-all"
            >
              <LogIn className="w-5 h-5" />
              {isSubmitting ? '处理中...' : (isRegisterMode ? '立即注册' : '登录系统')}
            </button>
            <div className="text-center mt-2">
              <button 
                type="button" 
                onClick={() => { setIsRegisterMode(!isRegisterMode); setAuthError(''); }}
                className="text-sm text-indigo-400 hover:text-indigo-300 transition-colors"
              >
                {isRegisterMode ? '已有账号？去登录' : '没有账号？去注册'}
              </button>
            </div>
          </form>
        </div>
      </div>
    );
  }

  const filteredOrders = orders.filter(order => {
    const matchesSearch = 
      order.displayId.includes(searchQuery) || 
      order.bossId.includes(searchQuery) || 
      order.workerA.includes(searchQuery) || 
      order.workerB.includes(searchQuery) ||
      order.details.includes(searchQuery);
    const matchesStatus = statusFilter === '全部状态' || order.status === statusFilter;
    
    let matchesWorker = true;
    if (userProfile?.role === 'admin') {
      matchesWorker = workerFilter === '全部打手' || order.assignedWorkerIds.includes(workerFilter);
    } else {
      const myEmployeeRecord = employees.find(e => e.uid === user?.uid);
      if (myEmployeeRecord) {
        matchesWorker = order.assignedWorkerIds.includes(myEmployeeRecord.id);
      } else {
        matchesWorker = false;
      }
    }
    
    return matchesSearch && matchesStatus && matchesWorker;
  });

  const calculateEarnings = (employeeId: string, period: 'today' | 'month' | 'all') => {
    const now = new Date();
    return orders.reduce((total, order) => {
      // Only completed orders count towards earnings
      if (order.status !== '已完成') return total;
      if (!order.assignedWorkerIds.includes(employeeId)) return total;
      
      const orderDate = new Date(order.createdAt);
      let isMatch = false;
      
      if (period === 'today') {
        isMatch = orderDate.toDateString() === now.toDateString();
      } else if (period === 'month') {
        isMatch = orderDate.getMonth() === now.getMonth() && orderDate.getFullYear() === now.getFullYear();
      } else {
        isMatch = true;
      }

      if (isMatch) {
        return total + (order.amount / order.assignedWorkerIds.length);
      }
      return total;
    }, 0);
  };

  const getDailyChartData = () => {
    const myEmployeeRecord = employees.find(e => e.uid === user?.uid);
    if (!myEmployeeRecord) return [];
    
    const data = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const dateStr = d.toDateString();
      
      const amount = orders.reduce((total, order) => {
        if (order.status !== '已完成') return total;
        if (!order.assignedWorkerIds.includes(myEmployeeRecord.id)) return total;
        if (new Date(order.createdAt).toDateString() === dateStr) {
          return total + (order.amount / order.assignedWorkerIds.length);
        }
        return total;
      }, 0);
      
      data.push({
        date: `${d.getMonth() + 1}/${d.getDate()}`,
        amount: Number(amount.toFixed(2))
      });
    }
    return data;
  };

  const getMonthlyChartData = () => {
    const myEmployeeRecord = employees.find(e => e.uid === user?.uid);
    if (!myEmployeeRecord) return [];
    
    const data = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date();
      d.setMonth(d.getMonth() - i);
      const monthStr = `${d.getFullYear()}-${d.getMonth()}`;
      
      const amount = orders.reduce((total, order) => {
        if (order.status !== '已完成') return total;
        if (!order.assignedWorkerIds.includes(myEmployeeRecord.id)) return total;
        const orderDate = new Date(order.createdAt);
        if (`${orderDate.getFullYear()}-${orderDate.getMonth()}` === monthStr) {
          return total + (order.amount / order.assignedWorkerIds.length);
        }
        return total;
      }, 0);
      
      data.push({
        month: `${d.getMonth() + 1}月`,
        amount: Number(amount.toFixed(2))
      });
    }
    return data;
  };

  const formatTime = (isoString: string) => {
    const date = new Date(isoString);
    const month = date.getMonth() + 1;
    const day = date.getDate();
    const hours = date.getHours().toString().padStart(2, '0');
    const minutes = date.getMinutes().toString().padStart(2, '0');
    return `${month}-${day} ${hours}:${minutes}`;
  };

  return (
    <div className="min-h-screen bg-[#0F1115] text-[#E5E7EB] font-sans selection:bg-[#4F46E5]/30">
      <Toaster position="top-right" />
      
      {/* Profile Setup Modal */}
      {showProfileSetup && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="bg-[#1A1D24] p-8 rounded-2xl border border-white/10 w-96 shadow-2xl">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-xl font-bold text-white">完善个人资料</h2>
              <button 
                onClick={() => {
                  logout();
                  setShowProfileSetup(false);
                }} 
                type="button"
                className="text-[#9CA3AF] hover:text-white transition-colors"
                title="取消并退出"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleProfileSetup} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-[#9CA3AF] mb-1">您的姓名</label>
                <input required name="name" type="text" className="w-full bg-[#0F1115] border border-white/10 rounded-lg px-4 py-2 text-white focus:border-[#4F46E5] focus:outline-none" placeholder="输入真实姓名或花名" />
              </div>
              <div>
                <label className="block text-sm font-medium text-[#9CA3AF] mb-1">选择角色</label>
                <select required name="role" className="w-full bg-[#0F1115] border border-white/10 rounded-lg px-4 py-2 text-white focus:border-[#4F46E5] focus:outline-none">
                  <option value="worker">员工 (打手)</option>
                  <option value="admin">管理员 (发单员)</option>
                </select>
              </div>
              <button disabled={isSubmitting} type="submit" className="w-full mt-6 py-2.5 bg-[#4F46E5] hover:bg-indigo-500 disabled:opacity-50 text-white font-semibold rounded-lg shadow-[0_4px_14px_rgba(79,70,229,0.3)] transition-all">
                {isSubmitting ? '保存中...' : '保存并进入系统'}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Create Order Modal (Admin Only) */}
      {showCreateOrder && userProfile?.role === 'admin' && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="bg-[#1A1D24] p-8 rounded-2xl border border-white/10 w-[500px] shadow-2xl">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-xl font-bold text-white">新建派单</h2>
              <button onClick={() => { setShowCreateOrder(false); setSelectedWorkerAId(''); }} className="text-[#9CA3AF] hover:text-white"><X className="w-5 h-5" /></button>
            </div>
            <form onSubmit={handleCreateOrder} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-[#9CA3AF] mb-1">老板ID/房间码</label>
                <input required name="bossId" type="text" className="w-full bg-[#0F1115] border border-white/10 rounded-lg px-4 py-2 text-white focus:border-[#4F46E5] focus:outline-none" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-[#9CA3AF] mb-1">指定打手A</label>
                  <select required name="workerAId" value={selectedWorkerAId} onChange={(e) => setSelectedWorkerAId(e.target.value)} className="w-full bg-[#0F1115] border border-white/10 rounded-lg px-4 py-2 text-white focus:border-[#4F46E5] focus:outline-none">
                    <option value="">请选择</option>
                    {employees.filter(e => e.isAvailable).map(emp => (
                      <option key={emp.id} value={emp.id}>{emp.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-[#9CA3AF] mb-1">指定打手B (可选)</label>
                  <select name="workerBId" className="w-full bg-[#0F1115] border border-white/10 rounded-lg px-4 py-2 text-white focus:border-[#4F46E5] focus:outline-none">
                    <option value="">无</option>
                    {employees.filter(e => e.isAvailable && e.id !== selectedWorkerAId).map(emp => (
                      <option key={emp.id} value={emp.id}>{emp.name}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-[#9CA3AF] mb-1">金额 (¥)</label>
                <input required name="amount" type="number" step="0.01" className="w-full bg-[#0F1115] border border-white/10 rounded-lg px-4 py-2 text-white focus:border-[#4F46E5] focus:outline-none" />
              </div>
              <div>
                <label className="block text-sm font-medium text-[#9CA3AF] mb-1">订单详情</label>
                <textarea name="details" rows={3} className="w-full bg-[#0F1115] border border-white/10 rounded-lg px-4 py-2 text-white focus:border-[#4F46E5] focus:outline-none resize-none" placeholder="填写订单其他要求（可选）"></textarea>
              </div>
              <button disabled={isSubmitting} type="submit" className="w-full mt-6 py-2.5 bg-[#10B981] hover:bg-emerald-500 disabled:opacity-50 text-white font-semibold rounded-lg shadow-[0_4px_14px_rgba(16,185,129,0.3)] transition-all">
                {isSubmitting ? '派单中...' : '确认派单'}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Create Employee Modal (Admin Only) */}
      {showCreateEmployee && userProfile?.role === 'admin' && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="bg-[#1A1D24] p-8 rounded-2xl border border-white/10 w-96 shadow-2xl">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-xl font-bold text-white">添加员工</h2>
              <button onClick={() => setShowCreateEmployee(false)} className="text-[#9CA3AF] hover:text-white"><X className="w-5 h-5" /></button>
            </div>
            <form onSubmit={handleCreateEmployee} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-[#9CA3AF] mb-1">员工系统UID</label>
                <input required name="employeeUid" type="text" className="w-full bg-[#0F1115] border border-white/10 rounded-lg px-4 py-2 text-white focus:border-[#4F46E5] focus:outline-none" placeholder="输入员工的个人UID" />
                <p className="text-xs text-[#6B7280] mt-1">员工姓名将自动同步该账户的个人资料，不需再手填</p>
              </div>
              <button disabled={isSubmitting} type="submit" className="w-full mt-6 py-2.5 bg-[#10B981] hover:bg-emerald-500 disabled:opacity-50 text-white font-semibold rounded-lg shadow-[0_4px_14px_rgba(16,185,129,0.3)] transition-all">
                {isSubmitting ? '添加中...' : '确认添加'}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Edit Order Modal */}
      {editingOrder && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="bg-[#1A1D24] p-8 rounded-2xl border border-white/10 w-[500px] shadow-2xl">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-xl font-bold text-white">编辑订单 #{editingOrder.displayId}</h2>
              <button onClick={() => setEditingOrder(null)} className="text-[#9CA3AF] hover:text-white"><X className="w-5 h-5" /></button>
            </div>
            <form onSubmit={handleUpdateOrder} className="space-y-4">
              {userProfile?.role === 'admin' ? (
                <>
                  <div>
                    <label className="block text-sm font-medium text-[#9CA3AF] mb-1">老板ID/房间码</label>
                    <input required name="bossId" defaultValue={editingOrder.bossId} type="text" className="w-full bg-[#0F1115] border border-white/10 rounded-lg px-4 py-2 text-white focus:border-[#4F46E5] focus:outline-none" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-[#9CA3AF] mb-1">金额 (¥)</label>
                    <input required name="amount" defaultValue={editingOrder.amount} type="number" step="0.01" className="w-full bg-[#0F1115] border border-white/10 rounded-lg px-4 py-2 text-white focus:border-[#4F46E5] focus:outline-none" />
                  </div>
                </>
              ) : (
                <>
                  <div>
                    <label className="block text-sm font-medium text-[#9CA3AF] mb-1">完善详情</label>
                    <textarea name="details" defaultValue={editingOrder.details} rows={3} className="w-full bg-[#0F1115] border border-white/10 rounded-lg px-4 py-2 text-white focus:border-[#4F46E5] focus:outline-none" placeholder="填写游戏进度、战绩等" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-[#9CA3AF] mb-1">截图数量</label>
                    <input required name="screenshots" defaultValue={editingOrder.screenshots} type="number" min="0" className="w-full bg-[#0F1115] border border-white/10 rounded-lg px-4 py-2 text-white focus:border-[#4F46E5] focus:outline-none" />
                  </div>
                </>
              )}

              <button disabled={isSubmitting} type="submit" className="w-full mt-6 py-2.5 bg-[#4F46E5] hover:bg-indigo-500 disabled:opacity-50 text-white font-semibold rounded-lg shadow-[0_4px_14px_rgba(79,70,229,0.3)] transition-all">
                {isSubmitting ? '保存中...' : '保存修改'}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {orderToDelete && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[60]">
          <div className="bg-[#1A1D24] p-6 rounded-2xl border border-white/10 w-80 shadow-2xl text-center">
            <AlertTriangle className="w-12 h-12 text-red-500 mx-auto mb-4" />
            <h2 className="text-lg font-bold text-white mb-2">确认作废订单？</h2>
            <p className="text-[#9CA3AF] text-sm mb-6">作废后该订单将不再生效且无法恢复。</p>
            <div className="flex gap-3">
              <button disabled={isDeleting} onClick={() => setOrderToDelete(null)} className="flex-1 py-2 bg-white/5 hover:bg-white/10 disabled:opacity-50 text-white rounded-lg transition-colors">取消</button>
              <button disabled={isDeleting} onClick={confirmDeleteOrder} className="flex-1 py-2 bg-red-500 hover:bg-red-600 disabled:opacity-50 text-white rounded-lg transition-colors">
                {isDeleting ? '处理中...' : '确认作废'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Employee Confirmation Modal */}
      {employeeToDelete && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[60]">
          <div className="bg-[#1A1D24] p-6 rounded-2xl border border-white/10 w-80 shadow-2xl text-center">
            <AlertTriangle className="w-12 h-12 text-red-500 mx-auto mb-4" />
            <h2 className="text-lg font-bold text-white mb-2">确认删除员工？</h2>
            <p className="text-[#9CA3AF] text-sm mb-6">删除后不可恢复，请谨慎操作。</p>
            <div className="flex gap-3">
              <button disabled={isDeleting} onClick={() => setEmployeeToDelete(null)} className="flex-1 py-2 bg-white/5 hover:bg-white/10 disabled:opacity-50 text-white rounded-lg transition-colors">取消</button>
              <button disabled={isDeleting} onClick={confirmDeleteEmployee} className="flex-1 py-2 bg-red-500 hover:bg-red-600 disabled:opacity-50 text-white rounded-lg transition-colors">
                {isDeleting ? '删除中...' : '确认删除'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Rename Modal */}
      {renameTarget && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[60]">
          <div className="bg-[#1A1D24] p-8 rounded-2xl border border-white/10 w-[400px] shadow-2xl">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-xl font-bold text-white">修改姓名</h2>
              <button onClick={() => setRenameTarget(null)} className="text-[#9CA3AF] hover:text-white"><X className="w-5 h-5" /></button>
            </div>
            <form onSubmit={handleRenameSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-[#9CA3AF] mb-1">新姓名</label>
                <input required name="newName" defaultValue={renameTarget.currentName} type="text" className="w-full bg-[#0F1115] border border-white/10 rounded-lg px-4 py-2 text-white focus:border-[#4F46E5] focus:outline-none" placeholder="输入新姓名" />
              </div>
              <button disabled={isSubmitting} type="submit" className="w-full mt-6 py-2.5 bg-[#4F46E5] hover:bg-indigo-500 disabled:opacity-50 text-white font-semibold rounded-lg shadow-[0_4px_14px_rgba(79,70,229,0.3)] transition-all">
                {isSubmitting ? '保存中...' : '保存修改'}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Employee History Modal */}
      {selectedEmployee && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="bg-[#1A1D24] p-8 rounded-2xl border border-white/10 w-[800px] max-h-[80vh] flex flex-col shadow-2xl">
            <div className="flex justify-between items-center mb-6">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-[#4F46E5]/20 flex items-center justify-center text-[#4F46E5] font-bold">
                  {selectedEmployee.name.charAt(0)}
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="text-xl font-bold text-white">{selectedEmployee.name} 的订单记录</h2>
                  </div>
                  <p className="text-sm text-[#9CA3AF]">总收益: ¥{calculateEarnings(selectedEmployee.id, 'all').toFixed(2)}</p>
                </div>
              </div>
              <button onClick={() => setSelectedEmployee(null)} className="text-[#9CA3AF] hover:text-white"><X className="w-5 h-5" /></button>
            </div>
            
            <div className="flex gap-2 mb-4">
              {(['today', 'month', 'all'] as const).map(period => (
                <button
                  key={period}
                  onClick={() => setHistoryPeriod(period)}
                  className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${historyPeriod === period ? 'bg-[#4F46E5] text-white' : 'bg-white/5 text-[#9CA3AF] hover:bg-white/10'}`}
                >
                  {period === 'today' ? '今日' : period === 'month' ? '本月' : '全部'}
                </button>
              ))}
              <div className="ml-auto text-sm font-medium text-[#10B981] flex items-center">
                筛选收益: ¥{calculateEarnings(selectedEmployee.id, historyPeriod).toFixed(2)}
              </div>
            </div>

            <div className="flex-1 overflow-auto border border-white/10 rounded-lg">
              {(() => {
                const historyOrders = orders.filter(o => o.assignedWorkerIds.includes(selectedEmployee.id)).filter(o => {
                  if (historyPeriod === 'all') return true;
                  const d = new Date(o.createdAt);
                  const now = new Date();
                  if (historyPeriod === 'today') return d.toDateString() === now.toDateString();
                  return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
                });

                if (historyOrders.length === 0) {
                  return (
                    <div className="flex flex-col items-center justify-center h-full text-[#9CA3AF] py-12">
                      <ListOrdered className="w-12 h-12 mb-4 opacity-50" />
                      <p>暂无订单记录</p>
                    </div>
                  );
                }

                return (
                  <table className="w-full text-left border-collapse">
                    <thead className="sticky top-0 bg-[#0F1115] z-10">
                      <tr>
                        <th className="px-4 py-3 text-xs font-semibold text-[#9CA3AF] border-b border-white/10">时间/编号</th>
                        <th className="px-4 py-3 text-xs font-semibold text-[#9CA3AF] border-b border-white/10">老板ID</th>
                        <th className="px-4 py-3 text-xs font-semibold text-[#9CA3AF] border-b border-white/10">状态</th>
                        <th className="px-4 py-3 text-xs font-semibold text-[#9CA3AF] border-b border-white/10">订单金额</th>
                        <th className="px-4 py-3 text-xs font-semibold text-[#9CA3AF] border-b border-white/10">个人分成</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/10">
                      {historyOrders.map(order => (
                        <tr key={order.id} className="hover:bg-white/5">
                          <td className="px-4 py-3 text-sm text-[#E5E7EB]">
                            {formatTime(order.createdAt)} <span className="text-indigo-400 ml-1">#{order.displayId}</span>
                          </td>
                          <td className="px-4 py-3 text-sm text-[#E5E7EB]">{order.bossId}</td>
                          <td className="px-4 py-3 text-sm">
                            <span className={`px-2 py-0.5 rounded text-xs ${
                              order.status === '已完成' ? 'bg-[#10B981]/15 text-[#10B981]' : 
                              order.status === '已作废' ? 'bg-[#9CA3AF]/15 text-[#9CA3AF]' :
                              'bg-[#F59E0B]/15 text-[#F59E0B]'
                            }`}>
                              {order.status}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-sm text-[#9CA3AF]">¥{order.amount.toFixed(2)}</td>
                          <td className="px-4 py-3 text-sm font-bold text-[#10B981]">
                            {order.status === '已完成' ? `¥${(order.amount / order.assignedWorkerIds.length).toFixed(2)}` : <span className="text-[#9CA3AF] font-normal">-</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                );
              })()}
            </div>
          </div>
        </div>
      )}

      {/* User Center Modal */}
      {showUserCenter && userProfile && user && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="bg-[#1A1D24] p-8 rounded-2xl border border-white/10 w-[400px] shadow-2xl">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-xl font-bold text-white">个人中心</h2>
              <button onClick={() => setShowUserCenter(false)} className="text-[#9CA3AF] hover:text-white"><X className="w-5 h-5" /></button>
            </div>
            
            <div className="space-y-6">
              <div className="flex items-center gap-4">
                <div className="w-16 h-16 rounded-full bg-[#4F46E5]/20 flex items-center justify-center text-2xl font-bold text-[#4F46E5]">
                  {userProfile.name.charAt(0)}
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <div className="text-lg font-bold text-white">{userProfile.name}</div>
                    <button onClick={() => { setRenameTarget({ type: 'user', id: user.uid, currentName: userProfile.name }); setShowUserCenter(false); }} className="text-[#4F46E5] hover:text-indigo-400 p-1 rounded-md hover:bg-white/5 transition-colors" title="修改姓名">
                      <Edit2 className="w-4 h-4" />
                    </button>
                  </div>
                  <div className="text-sm text-[#9CA3AF] mt-1">当前身份: {userProfile.role === 'admin' ? '管理员' : '员工'}</div>
                </div>
              </div>

              <div className="bg-[#0F1115] p-4 rounded-xl border border-white/5">
                <div className="text-xs text-[#9CA3AF] mb-1">个人系统 UID</div>
                <div className="text-sm font-mono text-[#E5E7EB] break-all select-all">{user.uid}</div>
                <div className="text-[10px] text-[#6B7280] mt-2">提示：管理员添加您为员工时，需要填写此UID。</div>
              </div>

              <div className="pt-4 border-t border-white/10 space-y-3">
                <button 
                  disabled={isSubmitting}
                  onClick={async () => {
                    if (isSubmitting) return;
                    setIsSubmitting(true);
                    try {
                      const newRole = userProfile.role === 'admin' ? 'worker' : 'admin';
                      await updateDoc(doc(db, 'users', user.uid), { role: newRole });
                      setUserProfile({ ...userProfile, role: newRole });
                      setShowUserCenter(false);
                      toast.success(`已切换为${newRole === 'admin' ? '管理员' : '员工'}身份`);
                    } catch (error) {
                      toast.error('切换身份失败');
                    } finally {
                      setIsSubmitting(false);
                    }
                  }}
                  className="w-full py-2.5 bg-white/5 hover:bg-white/10 disabled:opacity-50 text-white font-medium rounded-lg transition-colors flex items-center justify-center gap-2"
                >
                  <RefreshCw className={`w-4 h-4 ${isSubmitting ? 'animate-spin' : ''}`} />
                  {isSubmitting ? '切换中...' : `切换为${userProfile.role === 'admin' ? '员工' : '管理员'}身份`}
                </button>

                <button 
                  onClick={() => {
                    setShowUserCenter(false);
                    logout();
                  }}
                  className="w-full py-2.5 bg-red-500/10 hover:bg-red-500/20 text-red-500 font-medium rounded-lg transition-colors flex items-center justify-center gap-2"
                >
                  <LogOut className="w-4 h-4" />
                  退出登录
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <header className="flex items-center justify-between px-6 py-4 bg-[#15181E] border-b border-white/10 shadow-sm">
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2">
            <Gem className="w-6 h-6 text-[#4F46E5]" />
            <h1 className="text-xl font-bold text-[#E5E7EB] tracking-wide">安生工作室</h1>
            <span className="ml-2 px-2 py-0.5 text-[11px] font-semibold text-[#9CA3AF] border border-white/10 rounded-md bg-white/5">
              V13.90
            </span>
          </div>
          
          <div className="flex items-center gap-4 text-xs text-[#9CA3AF] bg-[#1A1D24] px-3 py-1.5 rounded-lg border border-white/10 hidden md:flex">
            <div className="flex items-center gap-1.5">
              <div className="w-1.5 h-1.5 rounded-full bg-[#10B981] animate-pulse"></div>
              <span>已连云端</span>
            </div>
            <div className="w-px h-3 bg-white/10"></div>
            <span className="text-[#E5E7EB] font-medium">{userProfile?.name} ({userProfile?.role === 'admin' ? '管理员' : '员工'})</span>
            
            {userProfile?.role !== 'admin' && (
              <>
                <div className="w-px h-3 bg-white/10"></div>
                <div className="flex items-center gap-2">
                  <span className={employees.find(e => e.uid === user?.uid)?.isAvailable ? "text-[#10B981]" : "text-[#9CA3AF]"}>
                    呼叫派单
                  </span>
                  <button 
                    onClick={async () => {
                      const emp = employees.find(e => e.uid === user?.uid);
                      if (!emp) return;
                      // Check for active orders
                      const activeOrders = orders.filter(o => o.assignedWorkerIds.includes(emp.id) && o.status === '进行中');
                      if (activeOrders.length > 0 && !emp.isAvailable) {
                        toast.error('您有进行中的订单，暂时无法变为空闲开启呼叫派单');
                        return;
                      }
                      const newIsAvailable = !emp.isAvailable;
                      await updateDoc(doc(db, 'employees', emp.id), { 
                        isAvailable: newIsAvailable,
                        status: newIsAvailable ? '空闲' : (activeOrders.length > 0 ? '接单中' : '离线')
                      });
                    }}
                    className={`w-8 h-4 rounded-full relative transition-colors ${employees.find(e => e.uid === user?.uid)?.isAvailable ? 'bg-[#10B981]' : 'bg-white/20'}`}
                  >
                    <div className={`w-3 h-3 bg-white rounded-full absolute top-0.5 transition-all ${employees.find(e => e.uid === user?.uid)?.isAvailable ? 'left-4.5' : 'left-0.5'}`}></div>
                  </button>
                </div>
              </>
            )}
          </div>
        </div>

        <div className="flex items-center gap-4">
          <div className="flex items-center bg-[#1A1D24] p-1 rounded-lg border border-white/10">
            <button 
              onClick={() => setActiveTab('orders')}
              className={`flex items-center gap-2 px-4 py-1.5 rounded-md text-sm font-medium transition-all ${
                activeTab === 'orders' ? 'bg-white/5 text-[#E5E7EB] border border-white/10 shadow-sm' : 'text-[#9CA3AF] hover:bg-white/5 border border-transparent'
              }`}
            >
              <ListOrdered className="w-4 h-4" />
              订单栏
            </button>
            <button 
              onClick={() => setActiveTab('employees')}
              className={`flex items-center gap-2 px-4 py-1.5 rounded-md text-sm font-medium transition-all ${
                activeTab === 'employees' ? 'bg-white/5 text-[#E5E7EB] border border-white/10 shadow-sm' : 'text-[#9CA3AF] hover:bg-white/5 border border-transparent'
              }`}
            >
              <Users className="w-4 h-4" />
              {userProfile?.role === 'admin' ? '员工资料' : '我的订单'}
            </button>
          </div>
          
          {userProfile?.role === 'admin' && (
            activeTab === 'orders' ? (
              <button 
                onClick={() => setShowCreateOrder(true)}
                className="flex items-center gap-2 px-5 py-2 bg-[#4F46E5] hover:bg-indigo-500 text-white text-sm font-semibold rounded-lg shadow-[0_4px_14px_rgba(79,70,229,0.3)] transition-all"
              >
                <Plus className="w-4 h-4" />
                发单
              </button>
            ) : (
              <button 
                onClick={() => setShowCreateEmployee(true)}
                className="flex items-center gap-2 px-5 py-2 bg-[#10B981] hover:bg-emerald-500 text-white text-sm font-semibold rounded-lg shadow-[0_4px_14px_rgba(16,185,129,0.3)] transition-all"
              >
                <Plus className="w-4 h-4" />
                添加员工
              </button>
            )
          )}

          <button onClick={() => setShowUserCenter(true)} className="flex items-center gap-2 px-3 py-1.5 bg-white/5 hover:bg-white/10 rounded-lg transition-colors border border-white/10">
            <div className="w-7 h-7 rounded-full bg-[#4F46E5] flex items-center justify-center text-xs font-bold text-white">
              {userProfile?.name?.charAt(0) || 'U'}
            </div>
            <span className="text-sm font-medium text-[#E5E7EB]">{userProfile?.name}</span>
          </button>
        </div>
      </header>

      {/* Main Content */}
      <main className="p-8">
        <div className="bg-[#1A1D24] rounded-2xl border border-white/10 shadow-xl overflow-hidden flex flex-col h-[calc(100vh-130px)]">
          
          {activeTab === 'orders' ? (
            <>
              {/* Toolbar */}
              <div className="flex items-center justify-between px-6 py-4 border-b border-white/10 bg-white/[0.02]">
                <h2 className="text-lg font-bold text-[#E5E7EB]">
                  {userProfile?.role === 'admin' ? '全部订单' : '我的派单'} ({filteredOrders.length})
                </h2>
                
                <div className="flex items-center gap-3">
                  {userProfile?.role === 'admin' && (
                    <div className="relative">
                      <select 
                        value={workerFilter}
                        onChange={(e) => setWorkerFilter(e.target.value)}
                        className="appearance-none bg-[#0F1115] border border-white/10 text-[#E5E7EB] text-sm rounded-lg pl-3 pr-8 py-2 focus:outline-none focus:border-[#4F46E5] cursor-pointer transition-colors"
                      >
                        <option value="全部打手">全部打手</option>
                        {employees.map(emp => (
                          <option key={emp.id} value={emp.id}>{emp.name}</option>
                        ))}
                      </select>
                      <ChevronDown className="w-4 h-4 text-[#9CA3AF] absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                    </div>
                  )}
                  <div className="relative">
                    <select 
                      value={statusFilter}
                      onChange={(e) => setStatusFilter(e.target.value)}
                      className="appearance-none bg-[#0F1115] border border-white/10 text-[#E5E7EB] text-sm rounded-lg pl-3 pr-8 py-2 focus:outline-none focus:border-[#4F46E5] cursor-pointer transition-colors"
                    >
                      <option>全部状态</option>
                      <option>进行中</option>
                      <option>待审核</option>
                      <option>已完成</option>
                    </select>
                    <ChevronDown className="w-4 h-4 text-[#9CA3AF] absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                  </div>

                  <div className="relative">
                    <Search className="w-4 h-4 text-[#9CA3AF] absolute left-3 top-1/2 -translate-y-1/2" />
                    <input 
                      type="text" 
                      placeholder="搜任意内容..." 
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="bg-[#0F1115] border border-white/10 text-[#E5E7EB] text-sm rounded-lg pl-9 pr-3 py-2 focus:outline-none focus:border-[#4F46E5] w-64 placeholder:text-[#9CA3AF] transition-colors"
                    />
                  </div>
                </div>
              </div>

              {/* Table */}
              <div className="flex-1 overflow-auto">
                {filteredOrders.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-full text-[#9CA3AF]">
                    <ListOrdered className="w-12 h-12 mb-4 opacity-50" />
                    <p>{orders.length === 0 ? (userProfile?.role === 'admin' ? '暂无订单，请点击右上角发单' : '暂无指派给您的订单') : '没有找到匹配的订单'}</p>
                  </div>
                ) : (
                  <table className="w-full text-left border-collapse">
                    <thead className="sticky top-0 bg-[#1A1D24] z-10 shadow-sm">
                      <tr>
                        <th className="px-6 py-4 text-xs font-semibold text-[#9CA3AF] uppercase tracking-wider whitespace-nowrap border-b border-white/10">时间/编号</th>
                        <th className="px-6 py-4 text-xs font-semibold text-[#9CA3AF] uppercase tracking-wider whitespace-nowrap border-b border-white/10">老板ID/房间码</th>
                        <th className="px-6 py-4 text-xs font-semibold text-[#9CA3AF] uppercase tracking-wider whitespace-nowrap border-b border-white/10">打手A</th>
                        <th className="px-6 py-4 text-xs font-semibold text-[#9CA3AF] uppercase tracking-wider whitespace-nowrap border-b border-white/10">打手B</th>
                        <th className="px-6 py-4 text-xs font-semibold text-[#9CA3AF] uppercase tracking-wider whitespace-nowrap border-b border-white/10">金额</th>
                        <th className="px-6 py-4 text-xs font-semibold text-[#9CA3AF] uppercase tracking-wider whitespace-nowrap border-b border-white/10">详情</th>
                        <th className="px-6 py-4 text-xs font-semibold text-[#9CA3AF] uppercase tracking-wider whitespace-nowrap border-b border-white/10 text-center">截图</th>
                        <th className="px-6 py-4 text-xs font-semibold text-[#9CA3AF] uppercase tracking-wider whitespace-nowrap border-b border-white/10 text-center">状态</th>
                        {userProfile?.role === 'admin' ? (
                           <th className="px-6 py-4 text-xs font-semibold text-[#9CA3AF] uppercase tracking-wider whitespace-nowrap border-b border-white/10 text-center">操作</th>
                        ) : (
                           <>
                             <th className="px-6 py-4 text-xs font-semibold text-[#9CA3AF] uppercase tracking-wider whitespace-nowrap border-b border-white/10 text-center">个人分成</th>
                             <th className="px-6 py-4 text-xs font-semibold text-[#9CA3AF] uppercase tracking-wider whitespace-nowrap border-b border-white/10 text-center">操作</th>
                           </>
                        )}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/10">
                      {filteredOrders.map((order) => (
                        <tr key={order.id} className="hover:bg-white/5 transition-colors group">
                          <td className="px-6 py-4 whitespace-nowrap">
                            <div className="text-sm text-[#E5E7EB]">{formatTime(order.createdAt)}</div>
                            <div className="text-xs text-indigo-400 font-mono mt-0.5">#{order.displayId}</div>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <div className="text-sm font-medium text-[#E5E7EB]">{order.bossId}</div>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <div className="text-sm text-[#9CA3AF]">{order.workerA || '-'}</div>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <div className="text-sm text-[#9CA3AF]">{order.workerB || '-'}</div>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <div className="text-sm font-bold text-[#10B981]">¥{order.amount.toFixed(2)}</div>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap max-w-[200px] truncate">
                            <div className="text-sm text-[#9CA3AF]">{order.details || '暂无详情'}</div>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-center">
                            {userProfile?.role === 'worker' ? (
                              <div className="flex justify-center flex-col gap-1 items-center">
                                {order.status === '进行中' ? (
                                   <button onClick={() => setUploadScreenshotOrderId(order.id)} className="px-2 py-1 text-xs font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded transition-colors">
                                      上传截图
                                   </button>
                                ) : (
                                  order.screenshots === 0 && <span className="text-xs text-[#9CA3AF]">无截图</span>
                                )}
                                {order.screenshots > 0 && <span className="text-[#10B981] text-[10px]">已传 {order.screenshots} 张</span>}
                              </div>
                            ) : (
                              order.screenshots === 0 ? (
                                <span className="text-xs text-[#9CA3AF]">无截图</span>
                              ) : (
                                <button onClick={() => setViewScreenshotsOrderId(order.id)} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-[#4F46E5] bg-[#4F46E5]/10 hover:bg-[#4F46E5]/20 border border-[#4F46E5]/20 rounded-md transition-colors">
                                  <Eye className="w-3.5 h-3.5" />
                                  查看({order.screenshots})
                                </button>
                              )
                            )}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-center">
                            <span className={`px-2 py-0.5 rounded text-[11px] font-semibold ${
                              order.status === '进行中' ? 'bg-[#3B82F6]/15 text-[#3B82F6]' : 
                              order.status === '待审核' ? 'bg-[#F59E0B]/15 text-[#F59E0B]' :
                              order.status === '已作废' ? 'bg-[#9CA3AF]/15 text-[#9CA3AF]' :
                              'bg-[#10B981]/15 text-[#10B981]'
                            }`}>
                              {order.status}
                            </span>
                          </td>
                          {userProfile?.role === 'worker' && (
                            <>
                              <td className="px-6 py-4 whitespace-nowrap text-center">
                                <div className="text-sm font-bold text-[#10B981]">
                                  {order.status === '已完成' ? `¥${(order.amount / order.assignedWorkerIds.length).toFixed(2)}` : <span className="text-[#9CA3AF] font-normal">-</span>}
                                </div>
                              </td>
                              <td className="px-6 py-4 whitespace-nowrap text-center">
                                {order.status === '进行中' ? (
                                  <button 
                                     onClick={() => handleStatusChange(order.id, '待审核')} 
                                     disabled={order.screenshots === 0}
                                     title={order.screenshots === 0 ? "请先上传截图证明" : ""}
                                     className="px-2 py-1 text-xs font-medium text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed rounded transition-colors"
                                  >
                                     服务完成
                                  </button>
                                ) : (
                                  <span className="text-xs text-[#9CA3AF]">-</span>
                                )}
                              </td>
                            </>
                          )}
                          {userProfile?.role === 'admin' && (
                             <td className="px-6 py-4 whitespace-nowrap text-center">
                               <div className="flex items-center justify-center min-h-[32px]">
                                 {activeActionOrderId === order.id ? (
                                   <div className="flex items-center gap-1">
                                     <button onClick={() => { setEditingOrder(order); setActiveActionOrderId(null); }} className="p-1.5 text-[#4F46E5] hover:bg-[#4F46E5]/10 rounded-md transition-colors" title="编辑">
                                       <Edit2 className="w-4 h-4" />
                                     </button>
                                     {order.status === '待审核' && (
                                       <button onClick={() => { setViewScreenshotsOrderId(order.id); setActiveActionOrderId(null); }} className="p-1.5 text-[#10B981] hover:bg-[#10B981]/10 rounded-md transition-colors" title="通过审核">
                                         <CheckCircle className="w-4 h-4" />
                                       </button>
                                     )}
                                     <button onClick={() => { setOrderToDelete(order.id); setActiveActionOrderId(null); }} className="p-1.5 text-red-500 hover:bg-red-500/10 rounded-md transition-colors" title="作废">
                                       <Trash2 className="w-4 h-4" />
                                     </button>
                                     <div className="w-px h-4 bg-white/10 mx-1"></div>
                                     <button onClick={() => setActiveActionOrderId(null)} className="p-1.5 text-[#9CA3AF] hover:bg-white/10 rounded-md transition-colors" title="取消">
                                       <X className="w-4 h-4" />
                                     </button>
                                   </div>
                                 ) : (
                                   <button onClick={() => setActiveActionOrderId(order.id)} className="px-3 py-1 text-xs font-medium text-[#9CA3AF] hover:text-white bg-white/5 hover:bg-white/10 border border-white/10 rounded transition-colors">
                                     操作
                                   </button>
                                 )}
                               </div>
                             </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </>
          ) : userProfile?.role === 'admin' ? (
            <div className="flex-1 p-6 overflow-auto">
              <div className="flex justify-between items-center mb-4">
                 <h2 className="text-lg font-bold text-[#E5E7EB] flex items-center gap-2">
                    <Users className="w-5 h-5 text-[#4F46E5]" />
                    员工库
                 </h2>
                 <div className="flex gap-2">
                    {isEditEmployeeMode ? (
                       <>
                         <button 
                            onClick={handleDeleteMultipleEmployees} 
                            disabled={selectedEmployeeIds.length === 0 || isDeleting}
                            className="px-3 py-1.5 bg-red-500 hover:bg-red-600 disabled:opacity-50 text-white text-sm rounded-md transition-colors flex items-center gap-1"
                         >
                            <Trash2 className="w-4 h-4" />
                            删除选中 ({selectedEmployeeIds.length})
                         </button>
                         <button 
                            onClick={() => {
                               setIsEditEmployeeMode(false);
                               setSelectedEmployeeIds([]);
                            }} 
                            className="px-3 py-1.5 bg-white/10 hover:bg-white/20 text-white text-sm rounded-md transition-colors"
                         >
                            取消编辑
                         </button>
                       </>
                    ) : (
                       <button 
                          onClick={() => setIsEditEmployeeMode(true)} 
                          className="px-3 py-1.5 bg-white/5 hover:bg-white/10 border border-white/10 text-white text-sm rounded-md transition-colors flex items-center gap-1"
                       >
                          <Edit2 className="w-4 h-4" />
                          管理员工
                       </button>
                    )}
                 </div>
              </div>
              
              <div className="mb-8">
                <h2 className="text-sm font-semibold text-[#10B981] mb-4 flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-[#10B981]"></div>
                  接单中 / 空闲员工
                </h2>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                  {employees.filter(e => e.isAvailable).map((emp) => (
                    <div 
                      key={emp.id} 
                      onClick={() => {
                         if (isEditEmployeeMode) {
                            setSelectedEmployeeIds(prev => prev.includes(emp.id) ? prev.filter(id => id !== emp.id) : [...prev, emp.id]);
                         } else {
                            setSelectedEmployee(emp);
                         }
                      }} 
                      className={`cursor-pointer transition-colors flex flex-col p-4 bg-white/[0.03] rounded-xl border relative ${isEditEmployeeMode && selectedEmployeeIds.includes(emp.id) ? 'border-red-500 bg-red-500/5' : 'border-[#10B981]/30 hover:bg-white/5'}`}
                    >
                      {isEditEmployeeMode && (
                        <div className="absolute top-3 right-3 text-white">
                           <div className={`w-5 h-5 rounded border flex items-center justify-center ${selectedEmployeeIds.includes(emp.id) ? 'bg-red-500 border-red-500' : 'border-white/30'}`}>
                              {selectedEmployeeIds.includes(emp.id) && <CheckCircle className="w-3 h-3 text-white" />}
                           </div>
                        </div>
                      )}
                      <div className="flex items-center gap-4 mb-3">
                        <div className="w-10 h-10 rounded-full bg-[#10B981]/20 flex items-center justify-center text-sm font-bold text-[#10B981]">
                          {emp.name.charAt(0)}
                        </div>
                        <div className="flex-1">
                          <div className="text-sm font-medium text-white">{emp.name}</div>
                          <div className="text-xs text-[#9CA3AF] mt-0.5">{emp.status}</div>
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-2 text-center border-t border-white/5 pt-3">
                        <div>
                          <div className="text-[10px] text-[#9CA3AF] mb-0.5">今日收益</div>
                          <div className="text-sm font-bold text-[#10B981]">¥{calculateEarnings(emp.id, 'today').toFixed(2)}</div>
                        </div>
                        <div>
                          <div className="text-[10px] text-[#9CA3AF] mb-0.5">本月收益</div>
                          <div className="text-sm font-bold text-[#E5E7EB]">¥{calculateEarnings(emp.id, 'month').toFixed(2)}</div>
                        </div>
                      </div>
                    </div>
                  ))}
                  {employees.filter(e => e.isAvailable).length === 0 && (
                    <div className="col-span-full text-sm text-[#9CA3AF] py-4 flex flex-col items-center justify-center">
                      <Users className="w-8 h-8 mb-2 opacity-50" />
                      暂无在线员工
                    </div>
                  )}
                </div>
              </div>

              <div>
                <h2 className="text-sm font-semibold text-[#6B7280] mb-4 flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-[#6B7280]"></div>
                  离线员工
                </h2>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                  {employees.filter(e => !e.isAvailable).map((emp) => (
                    <div 
                      key={emp.id} 
                      onClick={() => {
                         if (isEditEmployeeMode) {
                            setSelectedEmployeeIds(prev => prev.includes(emp.id) ? prev.filter(id => id !== emp.id) : [...prev, emp.id]);
                         } else {
                            setSelectedEmployee(emp);
                         }
                      }} 
                      className={`cursor-pointer transition-colors flex flex-col p-4 bg-white/[0.03] rounded-xl border relative ${isEditEmployeeMode && selectedEmployeeIds.includes(emp.id) ? 'border-red-500 bg-red-500/5' : 'border-white/5 opacity-70 hover:opacity-100 hover:bg-white/5'}`}
                    >
                      {isEditEmployeeMode && (
                        <div className="absolute top-3 right-3 text-white">
                           <div className={`w-5 h-5 rounded border flex items-center justify-center ${selectedEmployeeIds.includes(emp.id) ? 'bg-red-500 border-red-500' : 'border-white/30'}`}>
                              {selectedEmployeeIds.includes(emp.id) && <CheckCircle className="w-3 h-3 text-white" />}
                           </div>
                        </div>
                      )}
                      <div className="flex items-center gap-4 mb-3">
                        <div className="w-10 h-10 rounded-full bg-[#374151] flex items-center justify-center text-sm font-bold text-white">
                          {emp.name.charAt(0)}
                        </div>
                        <div className="flex-1">
                          <div className="text-sm font-medium text-white">{emp.name}</div>
                          <div className="text-xs text-[#9CA3AF] mt-0.5">{emp.status}</div>
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-2 text-center border-t border-white/5 pt-3">
                        <div>
                          <div className="text-[10px] text-[#9CA3AF] mb-0.5">今日收益</div>
                          <div className="text-sm font-bold text-[#10B981]">¥{calculateEarnings(emp.id, 'today').toFixed(2)}</div>
                        </div>
                        <div>
                          <div className="text-[10px] text-[#9CA3AF] mb-0.5">本月收益</div>
                          <div className="text-sm font-bold text-[#E5E7EB]">¥{calculateEarnings(emp.id, 'month').toFixed(2)}</div>
                        </div>
                      </div>
                    </div>
                  ))}
                  {employees.filter(e => !e.isAvailable).length === 0 && (
                    <div className="col-span-full text-sm text-[#9CA3AF] py-4 flex flex-col items-center justify-center">
                      <Users className="w-8 h-8 mb-2 opacity-50" />
                      暂无离线员工
                    </div>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div className="flex-1 p-6 overflow-auto flex flex-col">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6 shrink-0">
                <div className="bg-white/5 border border-white/10 rounded-xl p-6">
                  <h3 className="text-[#9CA3AF] text-sm font-medium mb-4">日总收入 (近7天)</h3>
                  <div className="h-48">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={getDailyChartData()}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#374151" vertical={false} />
                        <XAxis dataKey="date" stroke="#9CA3AF" fontSize={12} tickLine={false} axisLine={false} />
                        <YAxis stroke="#9CA3AF" fontSize={12} tickLine={false} axisLine={false} tickFormatter={(val) => `¥${val}`} />
                        <Tooltip cursor={{ fill: '#374151' }} contentStyle={{ backgroundColor: '#1A1D24', borderColor: '#374151', color: '#fff' }} />
                        <Bar dataKey="amount" fill="#10B981" radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
                <div className="bg-white/5 border border-white/10 rounded-xl p-6">
                  <h3 className="text-[#9CA3AF] text-sm font-medium mb-4">月总收入 (近6个月)</h3>
                  <div className="h-48">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={getMonthlyChartData()}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#374151" vertical={false} />
                        <XAxis dataKey="month" stroke="#9CA3AF" fontSize={12} tickLine={false} axisLine={false} />
                        <YAxis stroke="#9CA3AF" fontSize={12} tickLine={false} axisLine={false} tickFormatter={(val) => `¥${val}`} />
                        <Tooltip cursor={{ fill: '#374151' }} contentStyle={{ backgroundColor: '#1A1D24', borderColor: '#374151', color: '#fff' }} />
                        <Bar dataKey="amount" fill="#4F46E5" radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </div>
              
              <div className="flex items-center gap-4 mb-4 shrink-0">
                <div className="flex gap-2">
                  {(['today', 'month', 'all'] as const).map(period => (
                    <button
                      key={period}
                      onClick={() => setHistoryPeriod(period)}
                      className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${historyPeriod === period ? 'bg-[#4F46E5] text-white' : 'bg-white/5 text-[#9CA3AF] hover:bg-white/10'}`}
                    >
                      {period === 'today' ? '今日' : period === 'month' ? '本月' : '全部'}
                    </button>
                  ))}
                </div>
                {(() => {
                  const myOrders = filteredOrders.filter(o => {
                    if (historyPeriod === 'all') return true;
                    const d = new Date(o.createdAt);
                    const now = new Date();
                    if (historyPeriod === 'today') return d.toDateString() === now.toDateString();
                    return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
                  });
                  const sum = myOrders.filter(o => o.status === '已完成').reduce((acc, order) => acc + (order.amount / order.assignedWorkerIds.length), 0);
                  return (
                    <div className="text-sm font-medium text-[#E5E7EB]">
                      合计分成: <span className="text-[#10B981] ml-1">¥{sum.toFixed(2)}</span>
                    </div>
                  );
                })()}
              </div>

              <div className="flex-1 overflow-auto border border-white/10 rounded-lg min-h-[300px]">
                {(() => {
                  const myOrders = filteredOrders.filter(o => {
                    if (historyPeriod === 'all') return true;
                    const d = new Date(o.createdAt);
                    const now = new Date();
                    if (historyPeriod === 'today') return d.toDateString() === now.toDateString();
                    return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
                  });

                  if (myOrders.length === 0) {
                    return (
                      <div className="flex flex-col items-center justify-center h-full text-[#9CA3AF]">
                        <ListOrdered className="w-12 h-12 mb-4 opacity-50" />
                        <p>暂无订单记录</p>
                      </div>
                    );
                  }

                  return (
                    <table className="w-full text-left border-collapse">
                      <thead className="sticky top-0 bg-[#0F1115] z-10">
                        <tr>
                          <th className="px-4 py-3 text-xs font-semibold text-[#9CA3AF] border-b border-white/10">时间/编号</th>
                          <th className="px-4 py-3 text-xs font-semibold text-[#9CA3AF] border-b border-white/10">老板ID</th>
                          <th className="px-4 py-3 text-xs font-semibold text-[#9CA3AF] border-b border-white/10">状态</th>
                          <th className="px-4 py-3 text-xs font-semibold text-[#9CA3AF] border-b border-white/10">订单金额</th>
                          <th className="px-4 py-3 text-xs font-semibold text-[#9CA3AF] border-b border-white/10">个人分成</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-white/10">
                        {myOrders.map(order => (
                          <tr key={order.id} className="hover:bg-white/5">
                            <td className="px-4 py-3 text-sm text-[#E5E7EB]">
                              {formatTime(order.createdAt)} <span className="text-indigo-400 ml-1">#{order.displayId}</span>
                            </td>
                            <td className="px-4 py-3 text-sm text-[#E5E7EB]">{order.bossId}</td>
                            <td className="px-4 py-3">
                              <span className={`px-2 py-0.5 rounded text-[10px] font-semibold ${
                                order.status === '进行中' ? 'bg-[#3B82F6]/15 text-[#3B82F6]' : 
                                order.status === '待审核' ? 'bg-[#F59E0B]/15 text-[#F59E0B]' :
                                order.status === '已作废' ? 'bg-[#9CA3AF]/15 text-[#9CA3AF]' :
                                'bg-[#10B981]/15 text-[#10B981]'
                              }`}>
                                {order.status}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-sm text-[#E5E7EB]">¥{order.amount.toFixed(2)}</td>
                            <td className="px-4 py-3 text-sm font-bold text-[#10B981]">
                              {order.status === '已完成' ? `¥${(order.amount / order.assignedWorkerIds.length).toFixed(2)}` : <span className="text-[#9CA3AF] font-normal">-</span>}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  );
                })()}
              </div>
            </div>
          )}
        </div>
      </main>

      {/* Upload Screenshot Modal Config */}
      {uploadScreenshotOrderId && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[70]">
          <div className="bg-[#1A1D24] p-8 rounded-2xl border border-white/10 w-96 shadow-2xl text-center">
             <h2 className="text-lg font-bold text-white mb-4">上传截图</h2>
             <p className="text-sm text-[#9CA3AF] mb-6">为了确保服务真实性，请上传证明截图（可多选）。</p>
             <label className={`block w-full py-2 bg-indigo-600 hover:bg-indigo-700 ${isSubmitting ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'} text-white rounded transition-colors mb-3`}>
               {isSubmitting ? '上传中...' : '选择照片并上传'}
               <input 
                 type="file" 
                 multiple 
                 accept="image/*"
                 className="hidden"
                 onChange={async (e) => {
                   if (!e.target.files?.length || isSubmitting) return;
                   setIsSubmitting(true);
                   try {
                     const fileCount = e.target.files.length;
                     await new Promise(r => setTimeout(r, 1000));
                     const order = orders.find(o => o.id === uploadScreenshotOrderId);
                     if (order) {
                        await updateDoc(doc(db, 'orders', uploadScreenshotOrderId), {
                           screenshots: order.screenshots + fileCount
                        });
                        toast.success(`成功上传 ${fileCount} 张截图`);
                     }
                   } catch (e) {
                      console.error('Upload Error:', e);
                      toast.error('上传失败');
                   } finally {
                      setIsSubmitting(false);
                      setUploadScreenshotOrderId(null);
                   }
                 }}
                 disabled={isSubmitting}
               />
             </label>
             <button onClick={() => setUploadScreenshotOrderId(null)} className="w-full py-2 bg-white/10 hover:bg-white/20 text-white rounded transition-colors">
                取消
             </button>
          </div>
        </div>
      )}

      {/* View Screenshots Modal Config */}
      {viewScreenshotsOrderId && (() => {
         const tgtOrder = orders.find(o => o.id === viewScreenshotsOrderId);
         if (!tgtOrder) return null;
         return (
         <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-[80]" onClick={() => setViewScreenshotsOrderId(null)}>
            <div className="bg-[#1A1D24] p-6 rounded-2xl border border-white/10 max-w-2xl w-full mx-4 shadow-2xl relative" onClick={e => e.stopPropagation()}>
               <div className="flex justify-between items-center mb-6">
                  <h2 className="text-lg font-bold text-white">订单 #{tgtOrder.displayId} - 截图 ({tgtOrder.screenshots}张)</h2>
                  <button onClick={() => setViewScreenshotsOrderId(null)} className="p-1 hover:bg-white/10 rounded-full transition-colors text-white/70">
                    <X className="w-5 h-5" />
                  </button>
               </div>
               <div className="grid grid-cols-2 md:grid-cols-3 gap-4 max-h-[60vh] overflow-y-auto pr-2">
                  {Array.from({ length: tgtOrder.screenshots }).map((_, idx) => (
                     <div key={idx} className="aspect-square bg-black/50 rounded-lg overflow-hidden border border-white/5 relative group">
                        <img 
                          src={`https://picsum.photos/seed/${tgtOrder.id}_${idx}/400/400`} 
                          alt={`截图 ${idx + 1}`} 
                          className="w-full h-full object-cover"
                          referrerPolicy="no-referrer"
                        />
                        <div className="absolute inset-x-0 bottom-0 p-2 bg-gradient-to-t from-black/80 to-transparent flex items-end">
                           <span className="text-xs text-white/80 font-medium tracking-wide">图片 {idx + 1}</span>
                        </div>
                     </div>
                  ))}
               </div>
               {userProfile?.role === 'admin' && tgtOrder.status === '待审核' && (
                  <div className="mt-6">
                     <button
                        onClick={async () => {
                           setActiveActionOrderId(tgtOrder.id);
                           try {
                              await handleStatusChange(tgtOrder.id, '已完成');
                              setViewScreenshotsOrderId(null);
                           } finally {
                              setActiveActionOrderId(null);
                           }
                        }}
                        disabled={activeActionOrderId === tgtOrder.id}
                        className="w-full py-3 bg-[#10B981] hover:bg-[#059669] text-[#022C22] font-bold rounded-lg transition-colors flex items-center justify-center gap-2 shadow-sm"
                     >
                        {activeActionOrderId === tgtOrder.id ? '正在处理...' : '确认结单'}
                     </button>
                  </div>
               )}
               <p className="text-center text-xs text-[#9CA3AF] mt-4">这里使用的是随机占位图模拟真实的截图效果</p>
            </div>
         </div>
      ); })()}
    </div>
  );
}
